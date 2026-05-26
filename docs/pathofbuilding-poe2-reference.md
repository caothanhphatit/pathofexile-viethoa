# PathOfBuilding-PoE2 Reference Notes

Nguồn đọc: `PathOfBuildingCommunity/PathOfBuilding-PoE2`, branch `dev`, local snapshot `445ade0`.

Local reference clone: `scratch/PathOfBuilding-PoE2`.

## Mục tiêu áp dụng cho app mình

PoB-PoE2 là build planner offline hoàn chỉnh. App mình không cần bê toàn bộ calculator, nhưng passive tree nên học theo cách PoB xử lý dữ liệu gốc: giữ tọa độ tree thật, dùng metadata background/ascendancy từ tree data, precompute connector/path, rồi render theo state thay vì tự dựng vòng tròn và remap node bằng tay.

## Listing chức năng chính của PoB-PoE2

### Build planner

- Quản lý build offline: load/save build, import/export/share code, update build cũ theo tree version mới.
- Chọn class, ascendancy, level, bandit/pantheon kiểu PoE1 legacy nếu dữ liệu có.
- Sidebar tổng hợp chỉ số character, main skill, offence/defence.
- Notes/config tab để người dùng ghi chú và set điều kiện tính toán.

File chính:

- `src/Modules/Build.lua`
- `src/Modules/Main.lua`
- `src/Classes/ConfigTab.lua`
- `src/Classes/NotesTab.lua`

### Calculator offence/defence

- Tính DPS, damage over time, ailments, hit rate, accuracy, speed, reservation.
- Tính Life/Mana/Energy Shield, mitigation, block, recovery, flask, minion.
- Có breakdown chi tiết để biết chỉ số đến từ đâu.
- Có compare delta khi đổi item, gem hoặc passive node.

File chính:

- `src/Modules/Calcs.lua`
- `src/Modules/CalcSetup.lua`
- `src/Modules/CalcOffence.lua`
- `src/Modules/CalcDefence.lua`
- `src/Modules/CalcTools.lua`
- `src/Classes/CalcsTab.lua`

### Passive tree planner

- Render passive tree từ `src/TreeData/<version>/tree.json`.
- Tính tọa độ node theo `group`, `orbit`, `orbitIndex`, `orbitRadii`, `skillsPerOrbit/orbitAnglesByOrbit`.
- Dùng background thật của class/ascendancy từ `classes[].background` và `ascendancies[].background`.
- Precompute connector quads bằng `BuildConnector`/`BuildArc`; connector có state `Normal`, `Intermediate`, `Active`.
- Hover node thì preview path; click thì allocate full path; deallocate thì gỡ node phụ thuộc.
- Shift-hover/click hỗ trợ trace path thủ công.
- Support jewel radius, socket overlay, search highlight, compare màu xanh/đỏ.
- Ascendancy chọn bằng state của build/spec, không biến các ascendancy thành menu click nổi trên canvas.

File chính:

- `src/Classes/PassiveTree.lua`
- `src/Classes/PassiveTreeView.lua`
- `src/Classes/PassiveSpec.lua`
- `fix_ascendancy_positions.py`
- `src/TreeData/<version>/tree.json`
- `src/TreeData/<version>/*.png`

### Skill planner

- Thêm nhiều skill group, active/support gems.
- Toggle aura/curse/buff.
- Áp modifier từ item socketed gem, support gem granted by item.
- Skill data sinh từ template + GGPK export, có stat mapping riêng.

File chính:

- `src/Classes/SkillsTab.lua`
- `src/Classes/GemSelectControl.lua`
- `src/Data/Skills`
- `src/Export/Skills`
- `docs/addingSkills.md`

### Item planner/crafting/trade

- Paste item từ game vào app để parse.
- DB unique/base/rare template.
- Chỉnh roll modifier của unique.
- Craft item bằng prefix/suffix/custom modifier.
- So sánh upgrade và tạo trade query cho item có impact cao.

File chính:

- `src/Classes/ItemsTab.lua`
- `src/Classes/Item.lua`
- `src/Classes/ItemDBControl.lua`
- `src/Classes/TradeQuery.lua`
- `src/Classes/TradeQueryGenerator.lua`
- `src/Modules/ItemTools.lua`

### Import, compare, party, update

- Import character/tree/items/skills từ nguồn ngoài.
- Compare build hiện tại với build khác hoặc item trade.
- Party/support build support.
- Auto-update qua manifest.

File chính:

- `src/Classes/ImportTab.lua`
- `src/Classes/CompareTab.lua`
- `src/Classes/PartyTab.lua`
- `src/UpdateCheck.lua`
- `src/UpdateApply.lua`
- `manifest.xml`

## Passive tree: phần nên học kỹ

### 1. Tree coordinate không nên tự remap

PoB xử lý node tại `PassiveTreeClass:ProcessNode`:

- Lấy `node.angle` từ `orbitAnglesByOrbit` nếu data có sẵn.
- Lấy radius từ `constants.orbitRadii`.
- Tính:
  - `x = group.x * scaleImage + sin(angle) * orbitRadius`
  - `y = group.y * scaleImage - cos(angle) * orbitRadius`

App mình hiện đã tính tương tự nhưng đang fallback góc bằng công thức đều. Nên ưu tiên `constants.orbitAnglesByOrbit[orbit][orbitIndex]` vì PoE2 data có orbit không đều ở vài orbit.

### 2. Ascendancy background phải lấy từ data

PoB không dựng vòng tròn tuỳ ý. Nó dùng:

- `classes[].background`
- `classes[].ascendancies[].background`
- asset như `ClassesBlood Mage`, `ClassesStormweaver`
- texture nguồn trong `src/TreeData/0_4/ascendancy-background_*.dds.zst` và các png node/connector.

Khi chọn `Blood Mage`, PoB dùng `curAscendClassBaseName` để vẽ background của Blood Mage full color, asc khác dim hoặc ẩn theo `replace/replaceBy`.

Với app mình:

- Không nên render menu asc trên canvas.
- Dropdown chọn asc là source of truth.
- Khi chọn asc, fit viewport vào đúng `ascendancy.background` + node start/source liên quan.
- Nếu chưa convert được DDS/ZST background, dùng fallback circle nhỏ khít theo bounds, nhưng không remap node ra khỏi tọa độ thật.

### 3. Connector nên precompute hoặc chuẩn hoá theo PoB

PoB tạo connector ở `PassiveTreeClass:BuildConnector`:

- Bỏ connection nếu node khác `ascendancyName`.
- Bỏ connection vào class start trong connector list.
- Nếu connection có `orbit != 0`, tính arc center theo bán kính orbit.
- Nếu hai node cùng group/cùng orbit, vẽ arc quanh group center.
- Arc quá 90 độ thì tách thành hai connector bằng `BuildArc`.
- Còn lại mới dùng straight line quad.

App mình hiện đang vẽ line/arc trực tiếp trên canvas mỗi frame. Nên tách thành module geometry riêng để connector logic ổn định, test được, và đỡ rối.

### 4. Path allocation nên tách state graph khỏi renderer

PoB tách:

- `PassiveSpec:BuildAllDependsAndPaths`
- `PassiveSpec:GetEffectiveAllocationPath`
- `PassiveSpec:AllocNode`
- `PassiveSpec:DeallocNode`
- `PassiveSpec:SelectClass`
- `PassiveSpec:SelectAscendClass`

Renderer chỉ hỏi state: node allocated chưa, path hover là gì, connector active/intermediate chưa.

App mình nên tách phần graph/path ra khỏi `public/passive_tree.html`, vì file này đang ôm cả data transform, canvas renderer, UI state, pathing, tooltip.

## Function/pattern nên clone sang app mình

Ưu tiên clone ý tưởng, không copy nguyên Lua:

| Ưu tiên | PoB source | Clone sang app mình | Lý do |
| --- | --- | --- | --- |
| P0 | `PassiveTreeClass:ProcessNode` | `scripts/passive-tree/passive-tree-lib.mjs` | Tính tọa độ node đúng bằng `orbitAnglesByOrbit`, `orbitRadii`, `scaleImage`. |
| P0 | `classes[].background`, `ascendancies[].background` | export vào `public/data/passive-tree-data.js` | Cần background/fit viewport đúng, bỏ circle tự chế. |
| P0 | `PassiveTreeClass:BuildConnector` + `BuildArc` | `public/js/passive-tree/geometry.js` | Fix đường nối linh tinh, arc sai, connector dài quá. |
| P1 | `PassiveTreeView:Zoom` + `Focus` | `public/js/passive-tree/viewport.js` | Zoom giữ điểm dưới cursor, focus vào node/asc ổn hơn. |
| P1 | `PassiveSpec:GetEffectiveAllocationPath` | `public/js/passive-tree/pathing.js` | Hover/click path giống planner hơn. |
| P1 | `PassiveSpec:SelectAscendClass` | dropdown handler | Chọn asc thì allocate/anchor start node, không tạo selector trên canvas. |
| P1 | `PassiveTreeClass:GetNodeTargetSize` | renderer node sizing | Icon/node scale giống PoB hơn, đặc biệt ascendancy node. |
| P2 | jewel radius overlay | renderer overlay sau | Để sau khi core tree ổn. |
| P2 | compare build colors | future social/review build compare | Chưa cần cho bản tra cứu. |

Không nên clone lúc này:

- Full calculator offence/defence: quá lớn, khác mục tiêu web tra cứu.
- Item crafting engine: app mình có currency/items trước, nhưng chưa cần build planner.
- Trade query generator: phụ thuộc PoE trade API và item parser sâu.

## Gaps hiện tại của app mình

- `classes` export đang mất `background` của class và ascendancy.
- `groups` export chỉ có `x/y/orbits/nodes`, không có `background` của group.
- Node coordinate chưa dùng `orbitAnglesByOrbit` khi data cung cấp sẵn.
- Passive tree UI nằm trong một file lớn `public/passive_tree.html`, khó test từng phần.
- Ascendancy render đang có fallback circle và từng có remap node vào hub, khác PoB.
- Connector vẽ runtime từng edge, không có geometry precompute/quad state.
- Chưa dùng asset background/connector thật từ PoB tree data.

## Plan sửa passive tree theo PoB

### Phase 1: Data parity

- Update `scripts/passive-tree/passive-tree-lib.mjs`.
- Giữ `scaleImage`, `tree.size`, `classes[].background`, `ascendancies[].background`, `groups[].background`.
- `nodeCoordinates` ưu tiên `constants.orbitAnglesByOrbit[orbit][orbitIndex]`.
- Export thêm metadata này vào `public/data/passive-tree-data.js`.
- Test bằng `tests/passive-tree.test.mjs`.

### Phase 2: Renderer split

- Tách logic khỏi `public/passive_tree.html`:
  - `public/js/passive-tree/geometry.js`
  - `public/js/passive-tree/viewport.js`
  - `public/js/passive-tree/pathing.js`
  - `public/js/passive-tree/renderer.js`
- Giữ HTML chỉ còn shell/UI binding.
- Test parse module + unit geometry.

### Phase 3: Ascendancy đúng kiểu PoB

- Dropdown chọn asc.
- Không vẽ bất kỳ asc selector/menu nào trên canvas.
- Khi chọn asc:
  - dùng tọa độ asc gốc,
  - fit viewport vào `ascendancy.background` hoặc bounds node asc,
  - highlight selected asc,
  - dim/hide asc khác theo mode UI.
- Nếu chưa có asset background convert được thì fallback circle phải khít theo bounds, không phủ node source vô lý.

### Phase 4: Connector đúng hơn

- Port `BuildConnector`/`BuildArc` sang JS.
- Precompute connector geometry một lần sau khi data load.
- Draw connector state theo:
  - normal,
  - hover path/intermediate,
  - allocated/active.
- Skip cross-asc connector trong normal connector list giống PoB; connector từ base start sang asc start xử lý riêng theo selected asc.

### Phase 5: Interaction giống planner

- Hover node show tooltip ngay tại node.
- Hover unallocated node preview path.
- Click allocate full path.
- Click allocated node deallocate dependent nodes.
- Shift trace path để user chọn đường khác.
- Giữ point counter passive/ascendancy.

## Patch kế tiếp nên làm ngay

1. Sửa export data:
   - thêm `background` vào class/ascendancy/group rows,
   - thêm `scaleImage/treeSize`,
   - sửa angle theo `orbitAnglesByOrbit`.
2. Bỏ remap ascendancy node vào central hub trong UI.
3. Fit selected ascendancy bằng tọa độ thật:
   - `ascendancy.background` nếu có,
   - fallback node bounds nếu chưa có background.
4. Thêm test khóa:
   - dropdown không có option `all/Vòng ascendancy`,
   - selected asc không tạo canvas selector,
   - coordinate dùng `orbitAnglesByOrbit`,
   - export có `classes[].ascendancies[].background`.

## Ghi chú license

PoB-PoE2 dùng MIT. Có thể học/port pattern, nhưng khi copy trực tiếp đoạn code/asset cần giữ attribution/license phù hợp. Với app mình, nên port lại ý tưởng bằng JS và dùng data/asset theo đúng nguồn public của repo.
