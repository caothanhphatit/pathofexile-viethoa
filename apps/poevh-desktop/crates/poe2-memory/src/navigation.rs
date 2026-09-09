//! Obstacle-aware Smart Follow navigation.
//!
//! The controller tick only maintains a cached route and submits coalesced
//! requests. A single background worker owns A* buffers, so difficult maps can
//! never block manual input or the main runtime mutex.

use parking_lot::{Condvar, Mutex};
use poe2_types::Vec2;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const MIN_REPLAN: Duration = Duration::from_millis(300);
const ROUTE_STALE: Duration = Duration::from_millis(2500);
const GOAL_DRIFT: f32 = 4.0;
const OFF_PATH: f32 = 16.0;
const REACHED: f32 = 3.0;
const MAX_NODES: usize = 250_000;
const WORLD_CONFIRMATION_FRAMES: u8 = 3;

#[derive(Debug, Clone)]
pub struct TerrainGrid {
    pub area_id: u64,
    pub generation: u64,
    pub width: usize,
    pub height: usize,
    cells: Arc<[u8]>,
}

impl TerrainGrid {
    pub fn new(
        area_id: u64,
        generation: u64,
        width: usize,
        height: usize,
        cells: Vec<u8>,
    ) -> Option<Self> {
        if width == 0 || height == 0 || cells.len() != width.checked_mul(height)? {
            return None;
        }
        Some(Self {
            area_id,
            generation,
            width,
            height,
            cells: cells.into(),
        })
    }

    pub fn walkable(&self, x: i32, y: i32) -> bool {
        x >= 0
            && y >= 0
            && (x as usize) < self.width
            && (y as usize) < self.height
            && self.cells[y as usize * self.width + x as usize] != 0
    }

    pub fn line_of_sight(&self, from: Vec2, to: Vec2) -> bool {
        line_of_sight_cells(self, to_cell(from), to_cell(to))
    }
}

#[derive(Clone)]
struct RouteRequest {
    request_id: u64,
    follower: String,
    terrain: Arc<TerrainGrid>,
    start: (i32, i32),
    goal: (i32, i32),
}

struct RouteResult {
    request_id: u64,
    follower: String,
    area_id: u64,
    generation: u64,
    goal: Vec2,
    waypoints: Vec<Vec2>,
}

#[derive(Default)]
struct WorkerState {
    pending: HashMap<String, RouteRequest>,
    stop: bool,
}

struct RouteWorker {
    shared: Arc<(Mutex<WorkerState>, Condvar)>,
    results: mpsc::Receiver<RouteResult>,
    thread: Option<JoinHandle<()>>,
}

impl RouteWorker {
    fn new() -> Self {
        let shared = Arc::new((Mutex::new(WorkerState::default()), Condvar::new()));
        let (tx, results) = mpsc::channel();
        let worker_shared = Arc::clone(&shared);
        let thread = std::thread::Builder::new()
            .name("smart-follow-pathfinder".into())
            .spawn(move || worker_loop(worker_shared, tx))
            .expect("failed to start Smart Follow pathfinder");
        Self {
            shared,
            results,
            thread: Some(thread),
        }
    }

    fn enqueue(&self, request: RouteRequest) {
        let (state, signal) = &*self.shared;
        state
            .lock()
            .pending
            .insert(request.follower.clone(), request);
        signal.notify_one();
    }

    fn discard_pending(&self) {
        self.shared.0.lock().pending.clear();
    }
}

impl Drop for RouteWorker {
    fn drop(&mut self) {
        let (state, signal) = &*self.shared;
        state.lock().stop = true;
        signal.notify_one();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn worker_loop(shared: Arc<(Mutex<WorkerState>, Condvar)>, tx: mpsc::Sender<RouteResult>) {
    let mut planner = PathPlanner::default();
    loop {
        let request = {
            let (state, signal) = &*shared;
            let mut state = state.lock();
            while state.pending.is_empty() && !state.stop {
                signal.wait(&mut state);
            }
            if state.stop {
                return;
            }
            let key = state.pending.keys().next().cloned().unwrap_or_default();
            state.pending.remove(&key)
        };
        let Some(request) = request else { continue };
        let path = planner.find_path(&request.terrain, request.start, request.goal, MAX_NODES);
        let waypoints = smooth_path(&request.terrain, &path)
            .into_iter()
            .map(from_cell)
            .collect();
        let _ = tx.send(RouteResult {
            request_id: request.request_id,
            follower: request.follower,
            area_id: request.terrain.area_id,
            generation: request.terrain.generation,
            goal: from_cell(request.goal),
            waypoints,
        });
    }
}

#[derive(Default)]
struct RouteTracker {
    waypoints: Vec<Vec2>,
    cursor: usize,
    requested_at: Option<Instant>,
    applied_at: Option<Instant>,
    requested_start: Option<Vec2>,
    goal: Option<Vec2>,
    in_flight_request: Option<u64>,
    failures: u8,
    retry_after: Option<Instant>,
}

pub struct NavigationCoordinator {
    worker: RouteWorker,
    trackers: HashMap<String, RouteTracker>,
    completed: HashMap<String, RouteResult>,
    world_signature: Option<(u64, u64)>,
    confirmed_world_frames: u8,
    next_request_id: u64,
}

impl Default for NavigationCoordinator {
    fn default() -> Self {
        Self {
            worker: RouteWorker::new(),
            trackers: HashMap::new(),
            completed: HashMap::new(),
            world_signature: None,
            confirmed_world_frames: 0,
            next_request_id: 1,
        }
    }
}

impl NavigationCoordinator {
    /// Observe exactly once per fresh memory snapshot. Any area/layout change
    /// invalidates all breadcrumbs immediately. Three consecutive snapshots
    /// must then agree before movement resumes, preventing load-screen data
    /// from combining a new actor position with the previous terrain grid.
    pub fn observe_world_frame(&mut self, area_id: u64, generation: u64) -> bool {
        let signature = (area_id, generation);
        if area_id == 0 || generation == 0 {
            self.invalidate_world();
            return false;
        }
        if self.world_signature != Some(signature) {
            self.world_signature = Some(signature);
            self.confirmed_world_frames = 1;
            self.clear_routes();
        } else {
            self.confirmed_world_frames = self
                .confirmed_world_frames
                .saturating_add(1)
                .min(WORLD_CONFIRMATION_FRAMES);
        }
        self.confirmed_world_frames >= WORLD_CONFIRMATION_FRAMES
    }

    pub fn invalidate_world(&mut self) {
        self.world_signature = None;
        self.confirmed_world_frames = 0;
        self.clear_routes();
    }

    fn clear_routes(&mut self) {
        self.worker.discard_pending();
        self.trackers.clear();
        self.completed.clear();
    }

    pub fn steering_target(
        &mut self,
        follower: &str,
        start: Vec2,
        goal: Vec2,
        terrain: Arc<TerrainGrid>,
    ) -> Vec2 {
        if self.world_signature != Some((terrain.area_id, terrain.generation))
            || self.confirmed_world_frames < WORLD_CONFIRMATION_FRAMES
        {
            return start;
        }
        while let Ok(result) = self.worker.results.try_recv() {
            self.completed.insert(result.follower.clone(), result);
        }
        self.apply_result(follower, &terrain, goal, start);
        let tracker = self.trackers.entry(follower.to_string()).or_default();

        if terrain.line_of_sight(start, goal) {
            tracker.waypoints.clear();
            tracker.cursor = 0;
            tracker.failures = 0;
            return goal;
        }

        while tracker.cursor + 1 < tracker.waypoints.len() {
            let current = tracker.waypoints[tracker.cursor];
            let next = tracker.waypoints[tracker.cursor + 1];
            let reached = start.distance_to(current) <= REACHED;
            let segment = Vec2::new(next.x - current.x, next.y - current.y);
            let passed = segment.x * segment.x + segment.y * segment.y > 1e-3
                && (start.x - current.x) * segment.x + (start.y - current.y) * segment.y > 0.0;
            if !reached && !passed {
                break;
            }
            tracker.cursor += 1;
        }

        let now = Instant::now();
        let route_stale = tracker
            .applied_at
            .is_none_or(|at| now.duration_since(at) >= ROUTE_STALE);
        let goal_moved = tracker
            .goal
            .is_none_or(|old| old.distance_to(goal) > GOAL_DRIFT);
        let off_path = tracker
            .waypoints
            .get(tracker.cursor)
            .is_some_and(|next| point_segment_distance(start, *next, goal) > OFF_PATH);
        let moved_far = tracker
            .requested_start
            .is_some_and(|old| old.distance_to(start) > 12.0);
        let segment_blocked = tracker
            .waypoints
            .get(tracker.cursor)
            .is_some_and(|next| !terrain.line_of_sight(start, *next));
        let spacing_ok = tracker
            .requested_at
            .is_none_or(|at| now.duration_since(at) >= MIN_REPLAN);
        let retry_ok = tracker.retry_after.is_none_or(|until| now >= until);
        let should_replan = tracker.waypoints.is_empty()
            || route_stale
            || goal_moved
            || off_path
            || moved_far
            || segment_blocked;

        if should_replan && tracker.in_flight_request.is_none() && spacing_ok && retry_ok {
            let request_id = self.next_request_id;
            self.next_request_id = self.next_request_id.wrapping_add(1).max(1);
            tracker.in_flight_request = Some(request_id);
            tracker.requested_at = Some(now);
            tracker.requested_start = Some(start);
            self.worker.enqueue(RouteRequest {
                request_id,
                follower: follower.to_string(),
                terrain: terrain.clone(),
                start: to_cell(start),
                goal: to_cell(goal),
            });
        }

        if segment_blocked {
            start
        } else {
            tracker
                .waypoints
                .get(tracker.cursor)
                .copied()
                .unwrap_or(start)
        }
    }

    pub fn retain_followers<'a>(&mut self, names: impl Iterator<Item = &'a str>) {
        let names: std::collections::HashSet<&str> = names.collect();
        self.trackers
            .retain(|name, _| names.contains(name.as_str()));
        self.completed
            .retain(|name, _| names.contains(name.as_str()));
    }

    fn apply_result(
        &mut self,
        follower: &str,
        terrain: &TerrainGrid,
        live_goal: Vec2,
        live_start: Vec2,
    ) {
        if let Some(result) = self.completed.remove(follower) {
            let tracker = self.trackers.entry(follower.to_string()).or_default();
            // A worker may finish a request from the previous area after a new
            // request has already been queued. Such a result must not clear or
            // otherwise mutate the newer request's state.
            if tracker.in_flight_request != Some(result.request_id) {
                return;
            }
            tracker.in_flight_request = None;
            if result.area_id != terrain.area_id
                || result.generation != terrain.generation
                || result.goal.distance_to(live_goal) > GOAL_DRIFT
            {
                return;
            }
            let first_valid = result
                .waypoints
                .iter()
                .find(|point| live_start.distance_to(**point) > REACHED)
                .is_some_and(|first| terrain.line_of_sight(live_start, *first));
            if result.waypoints.is_empty() || !first_valid {
                tracker.waypoints.clear();
                tracker.failures = tracker.failures.saturating_add(1).min(5);
                let delay = 250u64.saturating_mul(1u64 << tracker.failures);
                tracker.retry_after = Some(Instant::now() + Duration::from_millis(delay.min(8000)));
                return;
            }
            tracker.waypoints = result.waypoints;
            tracker.cursor = tracker
                .waypoints
                .iter()
                .position(|point| live_start.distance_to(*point) > REACHED)
                .unwrap_or(tracker.waypoints.len().saturating_sub(1));
            tracker.goal = Some(result.goal);
            tracker.applied_at = Some(Instant::now());
            tracker.failures = 0;
            tracker.retry_after = None;
        }
    }
}

#[derive(Copy, Clone)]
struct OpenNode {
    index: usize,
    f: f32,
}
impl Eq for OpenNode {}
impl PartialEq for OpenNode {
    fn eq(&self, other: &Self) -> bool {
        self.index == other.index && self.f == other.f
    }
}
impl Ord for OpenNode {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .f
            .total_cmp(&self.f)
            .then_with(|| other.index.cmp(&self.index))
    }
}
impl PartialOrd for OpenNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Default)]
struct PathPlanner {
    width: usize,
    height: usize,
    scores: Vec<f32>,
    came_from: Vec<usize>,
    generations: Vec<u32>,
    generation: u32,
}

impl PathPlanner {
    fn find_path(
        &mut self,
        grid: &TerrainGrid,
        start: (i32, i32),
        goal: (i32, i32),
        max_nodes: usize,
    ) -> Vec<(i32, i32)> {
        let Some(start) = snap_walkable(grid, start, 32) else {
            return Vec::new();
        };
        let Some(goal) = snap_walkable(grid, goal, 32) else {
            return Vec::new();
        };
        if self.width != grid.width || self.height != grid.height {
            self.width = grid.width;
            self.height = grid.height;
            let count = grid.width * grid.height;
            self.scores.resize(count, 0.0);
            self.came_from.resize(count, usize::MAX);
            self.generations.resize(count, 0);
            self.generation = 0;
        }
        self.generation = self.generation.wrapping_add(1);
        if self.generation == 0 {
            self.generations.fill(0);
            self.generation = 1;
        }
        let start_idx = start.1 as usize * grid.width + start.0 as usize;
        let goal_idx = goal.1 as usize * grid.width + goal.0 as usize;
        self.scores[start_idx] = 0.0;
        self.came_from[start_idx] = usize::MAX;
        self.generations[start_idx] = self.generation;
        let mut open = BinaryHeap::new();
        open.push(OpenNode {
            index: start_idx,
            f: heuristic(start, goal),
        });
        let neighbors = [
            (-1, 0, 1.0),
            (1, 0, 1.0),
            (0, -1, 1.0),
            (0, 1, 1.0),
            (-1, -1, std::f32::consts::SQRT_2),
            (1, -1, std::f32::consts::SQRT_2),
            (-1, 1, std::f32::consts::SQRT_2),
            (1, 1, std::f32::consts::SQRT_2),
        ];
        let mut expanded = 0;
        while let Some(node) = open.pop() {
            if node.index == goal_idx {
                break;
            }
            expanded += 1;
            if expanded > max_nodes {
                return Vec::new();
            }
            let x = (node.index % grid.width) as i32;
            let y = (node.index / grid.width) as i32;
            let current_score = self.scores[node.index];
            for &(dx, dy, cost) in &neighbors {
                let nx = x + dx;
                let ny = y + dy;
                if !grid.walkable(nx, ny) {
                    continue;
                }
                if dx != 0 && dy != 0 && (!grid.walkable(x + dx, y) || !grid.walkable(x, y + dy)) {
                    continue;
                }
                let ni = ny as usize * grid.width + nx as usize;
                let tentative = current_score + cost;
                if self.generations[ni] == self.generation && tentative >= self.scores[ni] {
                    continue;
                }
                self.scores[ni] = tentative;
                self.came_from[ni] = node.index;
                self.generations[ni] = self.generation;
                open.push(OpenNode {
                    index: ni,
                    f: tentative + heuristic((nx, ny), goal) * 1.001,
                });
            }
        }
        if self.generations[goal_idx] != self.generation {
            return Vec::new();
        }
        let mut path = Vec::new();
        let mut current = goal_idx;
        loop {
            path.push(((current % grid.width) as i32, (current / grid.width) as i32));
            if current == start_idx {
                break;
            }
            current = self.came_from[current];
            if current == usize::MAX {
                return Vec::new();
            }
        }
        path.reverse();
        path
    }
}

#[cfg(test)]
fn find_path(
    grid: &TerrainGrid,
    start: (i32, i32),
    goal: (i32, i32),
    max_nodes: usize,
) -> Vec<(i32, i32)> {
    PathPlanner::default().find_path(grid, start, goal, max_nodes)
}

fn heuristic(a: (i32, i32), b: (i32, i32)) -> f32 {
    let dx = (a.0 - b.0).unsigned_abs() as f32;
    let dy = (a.1 - b.1).unsigned_abs() as f32;
    dx + dy + (std::f32::consts::SQRT_2 - 2.0) * dx.min(dy)
}

fn snap_walkable(grid: &TerrainGrid, point: (i32, i32), radius: i32) -> Option<(i32, i32)> {
    if grid.walkable(point.0, point.1) {
        return Some(point);
    }
    for r in 1..=radius {
        for dy in -r..=r {
            for dx in -r..=r {
                if dx.abs() != r && dy.abs() != r {
                    continue;
                }
                let p = (point.0 + dx, point.1 + dy);
                if grid.walkable(p.0, p.1) {
                    return Some(p);
                }
            }
        }
    }
    None
}

fn smooth_path(grid: &TerrainGrid, path: &[(i32, i32)]) -> Vec<(i32, i32)> {
    if path.len() <= 2 {
        return path.to_vec();
    }
    let mut result = vec![path[0]];
    let mut current = 0;
    while current < path.len() - 1 {
        let mut farthest = current + 1;
        for i in (current + 2..path.len()).rev() {
            let dx = path[i].0 - path[current].0;
            let dy = path[i].1 - path[current].1;
            if dx * dx + dy * dy > 100 * 100 {
                continue;
            }
            if line_of_sight_cells(grid, path[current], path[i]) {
                farthest = i;
                break;
            }
        }
        result.push(path[farthest]);
        current = farthest;
    }
    result
}

fn line_of_sight_cells(grid: &TerrainGrid, a: (i32, i32), b: (i32, i32)) -> bool {
    let (mut x, mut y) = a;
    let dx = (b.0 - a.0).abs();
    let sx = if a.0 < b.0 { 1 } else { -1 };
    let dy = -(b.1 - a.1).abs();
    let sy = if a.1 < b.1 { 1 } else { -1 };
    let mut err = dx + dy;
    loop {
        if !grid.walkable(x, y) {
            return false;
        }
        if (x, y) == b {
            return true;
        }
        let e2 = 2 * err;
        let old = (x, y);
        if e2 >= dy {
            err += dy;
            x += sx
        }
        if e2 <= dx {
            err += dx;
            y += sy
        }
        if x != old.0 && y != old.1 && (!grid.walkable(x, old.1) || !grid.walkable(old.0, y)) {
            return false;
        }
    }
}

fn to_cell(v: Vec2) -> (i32, i32) {
    (v.x.round() as i32, v.y.round() as i32)
}
fn from_cell(v: (i32, i32)) -> Vec2 {
    Vec2::new(v.0 as f32, v.1 as f32)
}
fn point_segment_distance(p: Vec2, a: Vec2, b: Vec2) -> f32 {
    let ab = Vec2::new(b.x - a.x, b.y - a.y);
    let len = ab.x * ab.x + ab.y * ab.y;
    if len < 1e-6 {
        return p.distance_to(a);
    }
    let t = (((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len).clamp(0.0, 1.0);
    p.distance_to(Vec2::new(a.x + ab.x * t, a.y + ab.y * t))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn grid(rows: &[&str]) -> TerrainGrid {
        let h = rows.len();
        let w = rows[0].len();
        let cells = rows
            .iter()
            .flat_map(|r| r.bytes().map(|b| u8::from(b == b'.')))
            .collect();
        TerrainGrid::new(1, 1, w, h, cells).unwrap()
    }
    #[test]
    fn routes_through_a_wall_gap() {
        let g = grid(&[".....", "..#..", "..#..", "....."]);
        let p = find_path(&g, (0, 1), (4, 1), 1000);
        assert!(!p.is_empty());
        assert!(p.iter().all(|&(x, y)| g.walkable(x, y)));
    }
    #[test]
    fn diagonal_cannot_cut_blocked_corner() {
        let g = grid(&[".#", "#."]);
        assert!(find_path(&g, (0, 0), (1, 1), 100).is_empty());
    }
    #[test]
    fn smoothing_keeps_obstacle_avoidance() {
        let g = grid(&[".....", "..#..", "..#..", "....."]);
        let p = find_path(&g, (0, 1), (4, 1), 1000);
        let s = smooth_path(&g, &p);
        assert!(s.len() >= 3);
        assert!(s.windows(2).all(|w| line_of_sight_cells(&g, w[0], w[1])));
    }

    #[test]
    fn world_change_requires_three_consecutive_frames_before_following() {
        let mut navigation = NavigationCoordinator::default();

        assert!(!navigation.observe_world_frame(10, 100));
        assert!(!navigation.observe_world_frame(10, 100));
        assert!(navigation.observe_world_frame(10, 100));

        // A new area must immediately close the gate again. This prevents the
        // previous area's breadcrumbs from driving a controller during load.
        assert!(!navigation.observe_world_frame(20, 200));
        assert!(!navigation.observe_world_frame(20, 200));
        assert!(navigation.observe_world_frame(20, 200));
    }

    #[test]
    fn world_change_discards_applied_and_completed_routes() {
        let mut navigation = NavigationCoordinator::default();
        navigation.trackers.insert(
            "Follower".into(),
            RouteTracker {
                waypoints: vec![Vec2::new(7.0, 8.0)],
                ..RouteTracker::default()
            },
        );
        navigation.completed.insert(
            "Follower".into(),
            RouteResult {
                request_id: 1,
                follower: "Follower".into(),
                area_id: 10,
                generation: 100,
                goal: Vec2::new(9.0, 9.0),
                waypoints: vec![Vec2::new(8.0, 8.0)],
            },
        );

        assert!(!navigation.observe_world_frame(20, 200));
        assert!(navigation.trackers.is_empty());
        assert!(navigation.completed.is_empty());
    }

    #[test]
    fn stale_result_cannot_clear_a_newer_in_flight_request() {
        let mut navigation = NavigationCoordinator::default();
        assert!(!navigation.observe_world_frame(20, 200));
        assert!(!navigation.observe_world_frame(20, 200));
        assert!(navigation.observe_world_frame(20, 200));
        navigation.trackers.insert(
            "Follower".into(),
            RouteTracker {
                in_flight_request: Some(2),
                ..RouteTracker::default()
            },
        );
        navigation.completed.insert(
            "Follower".into(),
            RouteResult {
                request_id: 1,
                follower: "Follower".into(),
                area_id: 10,
                generation: 100,
                goal: Vec2::new(9.0, 9.0),
                waypoints: vec![Vec2::new(8.0, 8.0)],
            },
        );

        let terrain = grid(&[".....", ".....", ".....", ".....", "....."]);
        navigation.apply_result(
            "Follower",
            &terrain,
            Vec2::new(4.0, 4.0),
            Vec2::new(0.0, 0.0),
        );
        assert_eq!(
            navigation
                .trackers
                .get("Follower")
                .and_then(|tracker| tracker.in_flight_request),
            Some(2)
        );
    }

    #[test]
    fn blocked_current_segment_holds_until_a_safe_route_is_ready() {
        let terrain = Arc::new(grid(&[".....", "..#..", "..#..", "....."]));
        let mut navigation = NavigationCoordinator::default();
        assert!(!navigation.observe_world_frame(1, 1));
        assert!(!navigation.observe_world_frame(1, 1));
        assert!(navigation.observe_world_frame(1, 1));
        navigation.trackers.insert(
            "Follower".into(),
            RouteTracker {
                waypoints: vec![Vec2::new(4.0, 1.0)],
                goal: Some(Vec2::new(4.0, 1.0)),
                applied_at: Some(Instant::now()),
                ..RouteTracker::default()
            },
        );

        let start = Vec2::new(0.0, 1.0);
        assert_eq!(
            navigation.steering_target("Follower", start, Vec2::new(4.0, 1.0), terrain,),
            start
        );
    }
}
