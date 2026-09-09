using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Globalization;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Diagnostics;
using LibBundle3;
using LibBundle3.Records;
using LibBundledGGPK3;
using BundleIndex = LibBundle3.Index;

internal sealed record PatchResult(
    bool Ok,
    bool Changed,
    string Format,
    List<string> ChangedAssets,
    List<string> AlreadyPatchedAssets,
    string Message,
    string? Error = null);

internal sealed record AssetBackup(
    string Target,
    string BackupFile,
    string? OriginalSha256 = null,
    string? PatchedSha256 = null,
    DateTimeOffset? CreatedAtUtc = null);

internal sealed record PendingAssetPatch(
    string Target,
    byte[] Original,
    byte[] Patched,
    Action<byte[]> Write);

internal static class Program
{
    private const string MinimapVisibility = "shaders/minimap_visibility_pixel.hlsl";
    private const string MinimapBlending = "shaders/minimap_blending_pixel.hlsl";
    private const string AtlasFog = "metadata/materials/environment/worldmap/worldmap_fogofwar.fxgraph";
    private const string CharacterCamera = "metadata/characters/character.ot";

    private static readonly string[] CameraFunctions =
    [
        "CreateCameraZoomNode", "ClearCameraZoomNodes", "CreateCameraLookAtNode",
        "CreateCameraPanNode", "ClearCameraPanNode", "ClearCameraPanNodes",
        "SetCustomCameraSpeed", "RemoveCustomCameraSpeed", "FaceCamera"
    ];

    private static readonly Dictionary<string, string> ColorModStats = new(StringComparer.Ordinal)
    {
        ["map_monsters_%_all_damage_to_gain_as_fire"] = "rgb(209,46,46)",
        ["map_monsters_%_physical_damage_to_gain_as_fire"] = "rgb(209,46,46)",
        ["map_monsters_%_all_damage_to_gain_as_cold"] = "rgb(209,46,46)",
        ["map_monsters_%_physical_damage_to_gain_as_cold"] = "rgb(209,46,46)",
        ["map_monsters_%_all_damage_to_gain_as_lightning"] = "rgb(209,46,46)",
        ["map_monsters_%_physical_damage_to_gain_as_lightning"] = "rgb(209,46,46)",
        ["map_monsters_%_all_damage_to_gain_as_chaos"] = "rgb(209,46,46)",
        ["map_monsters_%_physical_damage_to_gain_as_chaos"] = "rgb(209,46,46)",
        ["map_monsters_damage_+%"] = "rgb(209,46,46)",
        ["map_monster_damage_+%_final_from_deadly_atlas"] = "rgb(209,46,46)",
        ["map_monster_damage_+%_final_from_vital_atlas"] = "rgb(209,46,46)",
        ["map_monsters_attack_speed_+%"] = "rgb(209,46,46)",
        ["map_monsters_cast_speed_+%"] = "rgb(209,46,46)",
        ["map_monsters_movement_speed_+%"] = "rgb(209,46,46)",
        ["map_monsters_critical_strike_chance_+%"] = "rgb(209,46,46)",
        ["map_monsters_critical_strike_multiplier_+"] = "rgb(209,46,46)",
        ["map_monsters_chance_to_poison_on_hit_%"] = "rgb(209,46,46)",
        ["map_monsters_chance_to_inflict_bleeding_%"] = "rgb(209,46,46)",
        ["map_packs_fire_projectiles"] = "rgb(209,46,46)",
        ["map_monsters_penetrate_elemental_resistances_%"] = "rgb(209,46,46)",
        ["map_monsters_elemental_ailment_chance_+%"] = "rgb(209,46,46)",
        ["map_additional_player_maximum_resistances_%"] = "rgb(209,46,46)",
        ["map_player_life_and_es_recovery_speed_+%_final"] = "rgb(209,46,46)",
        ["map_monsters_life_+%"] = "rgb(74,230,58)",
        ["monster_life_+%_final_from_map"] = "rgb(74,230,58)",
        ["map_heist_monster_life_+%_final_from_sextant"] = "rgb(74,230,58)",
        ["map_monsters_armour_break_physical_damage_%_dealt_as_armour_break"] = "rgb(74,230,58)",
        ["map_monsters_accuracy_rating_+%"] = "rgb(74,230,58)",
        ["map_monsters_hit_damage_stun_multiplier_+%"] = "rgb(74,230,58)",
        ["map_monsters_additional_fire_resistance"] = "rgb(74,230,58)",
        ["map_monsters_additional_cold_resistance"] = "rgb(74,230,58)",
        ["map_monsters_additional_lightning_resistance"] = "rgb(74,230,58)",
        ["map_monsters_additional_chaos_resistance"] = "rgb(74,230,58)",
        ["map_monsters_ailment_threshold_+%"] = "rgb(74,230,58)",
        ["map_monsters_stun_threshold_+%"] = "rgb(74,230,58)",
        ["map_base_ground_fire_damage_to_deal_per_10_seconds"] = "rgb(74,230,58)",
        ["map_base_ground_fire_damage_to_deal_per_minute"] = "rgb(74,230,58)",
        ["map_ground_ice_base_magnitude"] = "rgb(74,230,58)",
        ["map_ground_ice"] = "rgb(74,230,58)",
        ["map_ground_lightning"] = "rgb(74,230,58)",
        ["map_ground_lightning_base_magnitude"] = "rgb(74,230,58)",
        ["flask_charges_gained_+%"] = "rgb(74,230,58)",
        ["map_players_cannot_gain_flask_charges"] = "rgb(74,230,58)",
        ["map_player_cooldown_speed_+%_final"] = "rgb(74,230,58)",
        ["map_monsters_base_self_critical_strike_multiplier_-%"] = "rgb(74,230,58)",
        ["map_monsters_curse_effect_on_self_+%_final"] = "rgb(74,230,58)",
        ["map_monsters_curse_effect_+%"] = "rgb(74,230,58)",
        ["map_monster_potency_+%_final_from_map"] = "rgb(255,204,27)",
        ["map_monster_potency_+%"] = "rgb(255,204,27)",
        ["map_item_drop_rarity_+%_final_from_map"] = "rgb(255,204,27)",
        ["map_item_drop_rarity_+%"] = "rgb(255,204,27)",
        ["map_pack_size_+%_final_from_map"] = "rgb(255,204,27)",
        ["map_pack_size_+%"] = "rgb(255,204,27)",
        ["map_number_of_magic_and_rare_packs_+%_final_and_rare_monster_modifiers_chance_+%_final_from_map"] = "rgb(255,204,27)",
        ["map_number_of_magic_and_rare_packs_+%_and_rare_monster_modifiers_chance_%"] = "rgb(255,204,27)",
        ["map_number_of_magic_packs_+%"] = "rgb(255,204,27)",
        ["map_number_of_rare_packs_+%"] = "rgb(255,204,27)",
        ["map_rare_monster_modifiers_chance_%"] = "rgb(255,204,27)",
        ["map_map_item_drop_chance_+%_final_from_map"] = "rgb(14,186,255)",
        ["map_map_item_drop_chance_+%"] = "rgb(14,186,255)"
    };

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0].Equals("--self-test", StringComparison.OrdinalIgnoreCase))
                return SelfTest();
            if (args.Length < 2)
                return Fail("Usage: --apply|--probe|--restore <Content.ggpk|_.index.bin> [features] [backup-dir]");

            var command = args[0].ToLowerInvariant();
            var target = Path.GetFullPath(args[1]);
            ConfigureOodleResolver(target);
            var backupDir = args.Length >= 4 ? Path.GetFullPath(args[3]) : string.Empty;
            var features = args.Length >= 3
                ? args[2].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase)
                : new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (!File.Exists(target))
                return Fail($"Không tìm thấy asset container: {target}");

            if (command is "--apply" or "--restore")
                EnsureGameIsClosed(target);

            return command switch
            {
                "--probe" => Probe(target),
                "--apply" => Apply(target, features, backupDir),
                "--restore" => Restore(target, backupDir),
                _ => Fail($"Lệnh không hợp lệ: {command}")
            };
        }
        catch (Exception ex)
        {
            return Fail(ex.GetBaseException().Message);
        }
    }

    private static int SelfTest()
    {
        const string visibility = """
            float4 main() {
                if (visibility_fully_revealed > 0.5f)
                    res_color = float4(1.0f, 0.0f, 0.0f, 1.0f);
                if (visibility_walkable_revealed > 0.5f) {
                    float prev_ratio = 0.0f;
                    float res_ratio = 1.0f;
                    res_color = float4(max(prev_ratio, res_ratio), 0.0f, 0.0f, 1.0f);
                }
                return res_color;
            }
            """;
        const string blendingSource = """
            float4 walkable_color = float4(1.0f, 1.0f, 1.0f, 0.01f);
            float4 encounter_color = float4(0.5f, 0.1f, 0.1f, 1.0f);
            float4 walkability_map_color = lerp(walkable_color, float4(0.5f, 0.5f, 1.0f, 0.5f), walkable_to_edge_ratio);
            walkability_map_color = lerp(walkability_map_color * float4(1.0f, 1.0f, 1.0f, visibility), float4(0.0f, 0.5f, 1.0f, 0.5f), pow(saturate(unexplored_edge), 25.0f));
            float aa_width = 0.2f;
            geometry_sample.a = lerp(geometry_sample.a, geometry_sample.a * max_walkable_fade, (1.0f - edge_to_unwalkable_ratio));
            float encounter_visibility = 1.0f;
            res_color = Uberblend(res_color, geometry_sample * float4(1.0f, 1.0f, 1.0f, encounter_visibility));
            res_color.rgb += decay_edge_color.rgb * (1.0f - edge_to_unwalkable_ratio);
            res_color.a *= saturate(1.0f - walkability_sample.b * 2.0f);
            """;
        var first = MinimapLayoutPatch.TransformVisibility(visibility);
        var second = MinimapLayoutPatch.TransformVisibility(first.Data);
        var blending = MinimapLayoutPatch.TransformBlending(blendingSource);
        var blendingSecond = MinimapLayoutPatch.TransformBlending(blending.Data);
        var unsupported = MinimapLayoutPatch.TransformBlending("float4 unrelated = 0;");
        var atlas = PatchAtlasFog("{\"nodes\":[[1,2]],\"links\":[3],\"other\":1}");
        var rain = PatchRain("{\"rain_intensity\": 1.0,\"clouds_intensity\": 0.7}");
        var environment = PatchEnvironmentParticles("{\"area\":{},\"effect_spawner\":{},\"rain_intensity\": 1}");
        var camera = PatchCharacterCamera("team = 1\r\n", 1.35);
        var color = PatchColorMods("description\r\n\t1 map_monsters_damage_+%\r\n\t1\r\n\t\"Damage\"");
        var ok = first.Changed && second.Already && blending.Changed && blendingSecond.Already
            && unsupported.Error is not null && atlas.Changed
            && first.Data.Contains("preserve exploration visibility", StringComparison.Ordinal)
            && blending.Data.Contains("layout_visibility", StringComparison.Ordinal)
            && blending.Data.Contains("hide non-layout geometry", StringComparison.Ordinal)
            && rain.Changed && rain.Data.Contains("\"rain_intensity\": 0.0", StringComparison.Ordinal)
            && environment.Changed && environment.Data.Contains("\"xffect_spawner\"", StringComparison.Ordinal)
            && camera.Changed && camera.Data.Contains("CreateCameraZoomNode", StringComparison.Ordinal)
            && color.Changed && color.Data.Contains("<rgb(209,46,46)>", StringComparison.Ordinal)
            && atlas.Data.Contains("\"nodes\": []", StringComparison.Ordinal)
            && atlas.Data.Contains("\"links\": []", StringComparison.Ordinal);
        return Write(new PatchResult(
            ok,
            false,
            "self-test",
            ok ? ["minimap", "atlas", "rain", "environment_particles", "camera", "color_mods"] : [],
            [],
            ok ? "Self-test passed" : "Self-test failed",
            ok ? null : $"visibility={first.Changed}/{second.Already}:{first.Error}; blending={blending.Changed}/{blendingSecond.Already}:{blending.Error}; unsupported={unsupported.Error}; atlas={atlas.Changed}; rain={rain.Changed}:{rain.Data}; environment={environment.Changed}:{environment.Data}; camera={camera.Changed}:{camera.Data}; color={color.Changed}:{color.Data}"));
    }

    private static int Probe(string target)
    {
        var result = OpenIndex(target, readOnly: true, out var index, out var disposable);
        if (result is not null)
            return Write(result);

        using (disposable)
        {
            var assets = new List<string>();
            var diagnostics = new List<string>();
            foreach (var path in new[] { MinimapVisibility, MinimapBlending, AtlasFog })
            {
                if (index!.TryGetFile(path, out _))
                    assets.Add(path);
            }

            var minimapSupported = false;
            if (index!.TryGetFile(MinimapVisibility, out var visibilityRecord)
                && visibilityRecord is not null
                && index.TryGetFile(MinimapBlending, out var blendingRecord)
                && blendingRecord is not null)
            {
                var visibility = MinimapLayoutPatch.TransformVisibility(
                    Encoding.ASCII.GetString(visibilityRecord.Read().Span));
                var blending = MinimapLayoutPatch.TransformBlending(
                    Encoding.ASCII.GetString(blendingRecord.Read().Span));
                minimapSupported = visibility.Error is null && blending.Error is null
                    && (visibility.Changed || visibility.Already)
                    && (blending.Changed || blending.Already);
                if (!minimapSupported)
                {
                    if (visibility.Error is not null)
                        diagnostics.Add(visibility.Error);
                    if (blending.Error is not null)
                        diagnostics.Add(blending.Error);
                }
            }
            if (minimapSupported)
                assets.Add("capability:minimap-layout");

            index!.ParsePaths();
            if (index.TryGetFile(CharacterCamera, out _))
                assets.Add("capability:camera");
            if (index.Files.Values.Any(record => record.Path?.StartsWith(
                    "metadata/environmentsettings/", StringComparison.OrdinalIgnoreCase) == true
                && record.Path.EndsWith(".env", StringComparison.OrdinalIgnoreCase)))
                assets.Add("capability:environment");
            if (index.Files.Values.Any(record => record.Path?.StartsWith(
                    "data/statdescriptions/", StringComparison.OrdinalIgnoreCase) == true
                && record.Path.EndsWith(".csd", StringComparison.OrdinalIgnoreCase)))
                assets.Add("capability:color_mods");

            return Write(new PatchResult(
                true,
                false,
                target.EndsWith("Content.ggpk", StringComparison.OrdinalIgnoreCase) ? "bundled-ggpk" : "bundles2-index",
                assets,
                [],
                assets.Count == 0
                    ? "Không tìm thấy shader/graph mục tiêu trong index hiện tại"
                    : diagnostics.Count == 0
                        ? "Đã nhận diện và kiểm tra cấu trúc asset patch target"
                        : "Có asset nhưng transformer không hỗ trợ cấu trúc hiện tại: " + string.Join(" | ", diagnostics)));
        }
    }

    private static int Apply(string target, HashSet<string> features, string backupDir)
    {
        if (string.IsNullOrWhiteSpace(backupDir))
            return Fail("Thiếu thư mục backup asset");

        Directory.CreateDirectory(backupDir);
        var openError = OpenIndex(target, readOnly: false, out var index, out var disposable);
        if (openError is not null)
            return Write(openError);

        using (disposable)
        {
            var changed = new List<string>();
            var already = new List<string>();
            var manifest = Path.Combine(backupDir, "ggpk_assets_manifest.json");
            var backups = File.Exists(manifest)
                ? JsonSerializer.Deserialize<List<AssetBackup>>(File.ReadAllText(manifest, Encoding.UTF8), JsonOptions) ?? []
                : [];

            if (features.Contains("minimap"))
            {
                PatchMinimapSet(index!, backupDir, changed, already, backups);
            }

            if (features.Contains("atlas"))
                PatchText(index!, AtlasFog, Encoding.Unicode, PatchAtlasFog, backupDir, changed, already, backups);

            var needsPaths = features.Contains("rain")
                || features.Contains("environment_particles")
                || features.Contains("color_mods")
                || features.Any(feature => feature.StartsWith("camera=", StringComparison.OrdinalIgnoreCase));
            if (needsPaths)
                index!.ParsePaths();

            if (features.Contains("rain"))
            {
                PatchMatchingText(
                    index!,
                    path => path.StartsWith("metadata/environmentsettings/", StringComparison.OrdinalIgnoreCase)
                        && path.EndsWith(".env", StringComparison.OrdinalIgnoreCase),
                    Encoding.Unicode,
                    PatchRain,
                    backupDir,
                    changed,
                    already,
                    backups);
            }

            if (features.Contains("environment_particles"))
            {
                PatchMatchingText(
                    index!,
                    path => path.StartsWith("metadata/environmentsettings/", StringComparison.OrdinalIgnoreCase)
                        && path.EndsWith(".env", StringComparison.OrdinalIgnoreCase),
                    Encoding.Unicode,
                    PatchEnvironmentParticles,
                    backupDir,
                    changed,
                    already,
                    backups);
            }

            var cameraFeature = features.FirstOrDefault(feature =>
                feature.StartsWith("camera=", StringComparison.OrdinalIgnoreCase));
            if (cameraFeature is not null
                && double.TryParse(cameraFeature.AsSpan("camera=".Length), NumberStyles.Float,
                    CultureInfo.InvariantCulture, out var zoomLevel))
            {
                PatchText(index!, CharacterCamera, Encoding.Unicode,
                    data => PatchCharacterCamera(data, zoomLevel), backupDir, changed, already, backups);
                PatchMatchingText(
                    index!,
                    path => path.StartsWith("metadata/", StringComparison.OrdinalIgnoreCase)
                        && !path.Equals(CharacterCamera, StringComparison.OrdinalIgnoreCase)
                        && (path.EndsWith(".ot", StringComparison.OrdinalIgnoreCase)
                            || path.EndsWith(".otc", StringComparison.OrdinalIgnoreCase)),
                    Encoding.Unicode,
                    PatchCameraFunctions,
                    backupDir,
                    changed,
                    already,
                    backups);
            }

            if (features.Contains("color_mods"))
            {
                PatchMatchingText(
                    index!,
                    path => path.StartsWith("data/statdescriptions/", StringComparison.OrdinalIgnoreCase)
                        && path.EndsWith(".csd", StringComparison.OrdinalIgnoreCase),
                    Encoding.Unicode,
                    PatchColorMods,
                    backupDir,
                    changed,
                    already,
                    backups);
            }

            if (changed.Count > 0)
                index!.Save();

            if (backups.Count > 0)
                WriteJsonAtomically(manifest, backups);

            var ok = changed.Count > 0 || already.Count > 0;
            return Write(new PatchResult(
                ok,
                changed.Count > 0,
                target.EndsWith("Content.ggpk", StringComparison.OrdinalIgnoreCase) ? "bundled-ggpk" : "bundles2-index",
                changed,
                already,
                ok ? "Asset patch đã xử lý" : "Không tìm thấy asset mục tiêu hoặc không có nội dung phù hợp"));
        }
    }

    private static void PatchMinimapSet(
        BundleIndex index,
        string backupDir,
        List<string> changed,
        List<string> already,
        List<AssetBackup> backups)
    {
        var pending = new List<PendingAssetPatch>();

        Stage(MinimapVisibility, MinimapLayoutPatch.TransformVisibility);
        Stage(MinimapBlending, data => MinimapLayoutPatch.TransformBlending(data));

        foreach (var patch in pending)
            EnsureBackup(patch.Target, patch.Original, patch.Patched, backupDir, backups);

        var written = new List<PendingAssetPatch>();
        try
        {
            foreach (var patch in pending)
            {
                patch.Write(patch.Patched);
                written.Add(patch);
                changed.Add(patch.Target);
            }
        }
        catch
        {
            foreach (var patch in written.AsEnumerable().Reverse())
            {
                try { patch.Write(patch.Original); }
                catch { /* The immutable backup remains available for manual recovery. */ }
                changed.Remove(patch.Target);
            }
            throw;
        }

        void Stage(string target, Func<string, MinimapTextPatch> transform)
        {
            if (!index.TryGetFile(target, out var record) || record is null)
                throw new InvalidOperationException($"Thiếu shader Mini-Map bắt buộc: {target}");

            var original = record.Read().ToArray();
            var outcome = transform(Encoding.ASCII.GetString(original));
            if (outcome.Error is not null)
                throw new InvalidOperationException($"Shader {target} không tương thích: {outcome.Error}");
            if (outcome.Already)
            {
                already.Add(target);
                return;
            }
            if (!outcome.Changed)
                throw new InvalidOperationException($"Shader {target} không tạo ra thay đổi an toàn");

            pending.Add(new PendingAssetPatch(
                target,
                original,
                Encoding.ASCII.GetBytes(outcome.Data),
                bytes => record.Write(bytes)));
        }
    }

    private static int Restore(string target, string backupDir)
    {
        if (string.IsNullOrWhiteSpace(backupDir))
            return Fail("Thiếu thư mục backup asset");

        var manifestPath = Path.Combine(backupDir, "ggpk_assets_manifest.json");
        if (!File.Exists(manifestPath))
            return Write(new PatchResult(true, false, "", [], [], "Không có asset backup để khôi phục"));

        var backups = JsonSerializer.Deserialize<List<AssetBackup>>(File.ReadAllText(manifestPath, Encoding.UTF8), JsonOptions) ?? [];
        var openError = OpenIndex(target, readOnly: false, out var index, out var disposable);
        if (openError is not null)
            return Write(openError);

        using (disposable)
        {
            var restored = new List<string>();
            var alreadyRestored = new List<string>();
            var selected = backups
                .Select((backup, order) => new { backup, order })
                .GroupBy(item => item.backup.Target, StringComparer.OrdinalIgnoreCase)
                .Select(group => group
                    .OrderBy(item => item.backup.CreatedAtUtc ?? DateTimeOffset.MinValue)
                    .ThenBy(item => item.order)
                    .Last().backup)
                .ToArray();
            var pending = new List<(AssetBackup Backup, byte[] Current, byte[] Original, Action<byte[]> Write)>();

            foreach (var backup in selected)
            {
                if (!File.Exists(backup.BackupFile))
                    throw new InvalidOperationException($"Thiếu file backup cho {backup.Target}: {backup.BackupFile}");
                if (!index!.TryGetFile(backup.Target, out var file) || file is null)
                    throw new InvalidOperationException($"Asset cần restore không còn tồn tại: {backup.Target}");

                var original = File.ReadAllBytes(backup.BackupFile);
                var originalHash = Sha256(original);
                if (backup.OriginalSha256 is not null
                    && !originalHash.Equals(backup.OriginalSha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException($"Backup {backup.Target} sai SHA-256; từ chối restore");

                var current = file.Read().ToArray();
                var currentHash = Sha256(current);
                if (currentHash.Equals(originalHash, StringComparison.OrdinalIgnoreCase))
                {
                    alreadyRestored.Add(backup.Target);
                    continue;
                }
                if (backup.PatchedSha256 is not null
                    && !currentHash.Equals(backup.PatchedSha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException(
                        $"Asset {backup.Target} đã thay đổi sau khi patch (có thể game vừa update); từ chối ghi đè bằng backup cũ");

                pending.Add((backup, current, original, bytes => file.Write(bytes)));
            }

            var written = new List<(AssetBackup Backup, byte[] Current, byte[] Original, Action<byte[]> Write)>();
            try
            {
                foreach (var item in pending)
                {
                    item.Write(item.Original);
                    written.Add(item);
                    restored.Add(item.Backup.Target);
                }
                if (restored.Count > 0)
                    index!.Save();
            }
            catch
            {
                foreach (var item in written.AsEnumerable().Reverse())
                {
                    try { item.Write(item.Current); }
                    catch { /* Keep immutable backup files for manual recovery. */ }
                }
                throw;
            }

            var completedTargets = restored.Concat(alreadyRestored)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            backups.RemoveAll(backup => completedTargets.Contains(backup.Target));
            if (backups.Count == 0)
                File.Delete(manifestPath);
            else
                WriteJsonAtomically(manifestPath, backups);

            return Write(new PatchResult(
                true,
                restored.Count > 0,
                "",
                restored,
                alreadyRestored,
                restored.Count > 0 ? "Đã khôi phục asset backup an toàn" : "Asset đã ở trạng thái gốc"));
        }
    }

    private static void PatchText(
        BundleIndex index,
        string target,
        Encoding encoding,
        Func<string, (string Data, bool Changed, bool Already)> patch,
        string backupDir,
        List<string> changed,
        List<string> already,
        List<AssetBackup> backups)
    {
        if (!index.TryGetFile(target, out var record) || record is null)
            return;

        var bytes = record.Read();
        var original = encoding.GetString(bytes.Span);
        var outcome = patch(original);
        if (outcome.Already)
        {
            already.Add(target);
            return;
        }
        if (!outcome.Changed)
            return;

        var newBytes = encoding.GetBytes(outcome.Data);
        EnsureBackup(target, bytes.ToArray(), newBytes, backupDir, backups);
        record.Write(newBytes);
        changed.Add(target);
    }

    private static void PatchMatchingText(
        BundleIndex index,
        Func<string, bool> predicate,
        Encoding encoding,
        Func<string, (string Data, bool Changed, bool Already)> patch,
        string backupDir,
        List<string> changed,
        List<string> already,
        List<AssetBackup> backups)
    {
        var targets = index.Files.Values
            .Select(record => record.Path)
            .Where(path => !string.IsNullOrWhiteSpace(path) && predicate(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        foreach (var target in targets)
            PatchText(index, target, encoding, patch, backupDir, changed, already, backups);
    }

    private static (string Data, bool Changed, bool Already) PatchAtlasFog(string data)
    {
        var result = ReplaceArrayProperty(data, "nodes");
        result = ReplaceArrayProperty(result, "links");
        if (result == data)
            return (data, false, data.Contains("\"nodes\":[]", StringComparison.Ordinal) || data.Contains("\"links\":[]", StringComparison.Ordinal));
        return (result, true, false);
    }

    private static (string Data, bool Changed, bool Already) PatchRain(string data)
    {
        var result = Regex.Replace(
            data,
            "(\"rain_intensity\"\\s*:\\s*)([^,\\r\\n}]+)(,?)",
            "${1}0.0${3}",
            RegexOptions.CultureInvariant);
        result = Regex.Replace(
            result,
            "(\"clouds_intensity\"\\s*:\\s*)([^,\\r\\n}]+)(,?)",
            "${1}0.0${3}",
            RegexOptions.CultureInvariant);
        var already = result == data && (data.Contains("\"rain_intensity\": 0.0", StringComparison.Ordinal)
            || data.Contains("\"clouds_intensity\": 0.0", StringComparison.Ordinal));
        return (result, result != data, already);
    }

    private static (string Data, bool Changed, bool Already) PatchEnvironmentParticles(string data)
    {
        var result = data
            .Replace("\"area\"", "\"xrea\"", StringComparison.Ordinal)
            .Replace("\"fog\"", "\"xog\"", StringComparison.Ordinal)
            .Replace("\"screenspace_fog\"", "\"xcreenspace_fog\"", StringComparison.Ordinal)
            .Replace("\"effect_spawner\"", "\"xffect_spawner\"", StringComparison.Ordinal)
            .Replace("\"post_processing\"", "\"xost_processing\"", StringComparison.Ordinal);
        result = Regex.Replace(
            result,
            "(\"clouds_intensity\"\\s*:\\s*)([^,\\r\\n}]+)(,?)",
            "${1}0.0${3}",
            RegexOptions.CultureInvariant);
        result = Regex.Replace(
            result,
            "(\"rain_intensity\"\\s*:\\s*)([^,\\r\\n}]+)(,?)",
            "${1}0.0${3}",
            RegexOptions.CultureInvariant);
        var already = result == data && (data.Contains("\"xffect_spawner\"", StringComparison.Ordinal)
            || data.Contains("\"xost_processing\"", StringComparison.Ordinal));
        return (result, result != data, already);
    }

    private static (string Data, bool Changed, bool Already) PatchCharacterCamera(string data, double zoomLevel)
    {
        var zoom = zoomLevel.ToString("0.0###", CultureInfo.InvariantCulture);
        var replacement = $"\ton_initial_position_set = {{CreateCameraZoomNode(5000.0, 5000.0, {zoom});}} ";
        var lines = data.Split("\r\n").ToList();
        var cameraLine = lines.FindIndex(line => line.Contains("CreateCameraZoomNode", StringComparison.Ordinal));
        if (cameraLine >= 0)
        {
            if (lines[cameraLine].Equals(replacement, StringComparison.Ordinal))
                return (data, false, true);
            lines[cameraLine] = replacement;
        }
        else
        {
            var teamLine = lines.FindIndex(line => line.Contains("team = 1", StringComparison.Ordinal));
            if (teamLine < 0)
                return (data, false, false);
            lines.Insert(teamLine + 1, replacement);
        }
        var result = string.Join("\r\n", lines);
        return (result, result != data, false);
    }

    private static (string Data, bool Changed, bool Already) PatchCameraFunctions(string data)
    {
        var result = data;
        foreach (var function in CameraFunctions)
            result = RemoveFunctionCalls(result, function);
        return (result, result != data, false);
    }

    private static string RemoveFunctionCalls(string data, string function)
    {
        var position = 0;
        while ((position = data.IndexOf(function, position, StringComparison.Ordinal)) >= 0)
        {
            var start = position;
            while (start > 0 && (char.IsLetterOrDigit(data[start - 1])
                || data[start - 1] is '_' or '.'))
                start--;

            var open = position + function.Length;
            while (open < data.Length && char.IsWhiteSpace(data[open]))
                open++;
            if (open >= data.Length || data[open] != '(')
            {
                position++;
                continue;
            }

            var depth = 1;
            var end = open + 1;
            while (end < data.Length && depth > 0)
            {
                if (data[end] == '(') depth++;
                else if (data[end] == ')') depth--;
                end++;
            }
            if (depth != 0)
            {
                position++;
                continue;
            }
            while (end < data.Length && char.IsWhiteSpace(data[end]))
                end++;
            if (end < data.Length && data[end] == ';')
            {
                data = data.Remove(start, end - start + 1);
                position = start;
            }
            else
            {
                position++;
            }
        }
        return data;
    }

    private static (string Data, bool Changed, bool Already) PatchColorMods(string data)
    {
        var lines = data.Split("\r\n").ToList();
        string? annotation = null;
        var state = 0; // 0: find description, 1: stat id, 2: line count, 3: values
        var remaining = 0;

        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            if (line.StartsWith("description", StringComparison.Ordinal))
            {
                state = 1;
                continue;
            }
            if (state == 0)
                continue;
            if (state == 1)
            {
                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                annotation = parts.Length >= 2 && ColorModStats.TryGetValue(parts[1], out var color)
                    ? color
                    : null;
                state = annotation is null ? 0 : 2;
                continue;
            }
            if (state == 2)
            {
                var first = line.Replace("\t", string.Empty, StringComparison.Ordinal)
                    .Split(' ', StringSplitOptions.RemoveEmptyEntries)
                    .FirstOrDefault();
                if (int.TryParse(first, NumberStyles.Integer, CultureInfo.InvariantCulture, out remaining))
                    state = 3;
                continue;
            }
            if (state != 3 || annotation is null)
                continue;

            if (line.Contains('<'))
            {
                lines[i] = Regex.Replace(line, "<.*?>", $"<{annotation}>");
            }
            else
            {
                lines[i] = Regex.Replace(line, "\"(.*?)\"", $"\"<{annotation}>{{{{$1}}}}\"");
            }
            remaining--;
            if (remaining <= 0)
                state = 2;
        }

        var result = string.Join("\r\n", lines);
        return (result, result != data, result == data && data.Contains("<rgb(", StringComparison.Ordinal));
    }

    private static string ReplaceArrayProperty(string data, string propertyName)
    {
        var key = $"\"{propertyName}\":";
        var index = data.IndexOf(key, StringComparison.Ordinal);
        if (index < 0)
            return data;
        var bracketStart = data.IndexOf('[', index);
        if (bracketStart < 0)
            return data;
        var depth = 1;
        var i = bracketStart + 1;
        while (i < data.Length && depth > 0)
        {
            if (data[i] == '[') depth++;
            else if (data[i] == ']') depth--;
            i++;
        }
        if (depth != 0)
            return data;
        var comma = data.IndexOf(',', i - 1);
        if (comma <= 0 || comma >= i + 5)
            return data;
        return data.Remove(index, comma - index + 1).Insert(index, $"\"{propertyName}\": [],");
    }

    private static string SafeName(string path)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(path))).ToLowerInvariant();
        return hash;
    }

    private static string Sha256(ReadOnlySpan<byte> data) =>
        Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();

    private static void EnsureBackup(
        string target,
        byte[] original,
        byte[] patched,
        string backupDir,
        List<AssetBackup> backups)
    {
        var originalHash = Sha256(original);
        var patchedHash = Sha256(patched);
        if (backups.Any(item => item.Target.Equals(target, StringComparison.OrdinalIgnoreCase)
            && item.OriginalSha256?.Equals(originalHash, StringComparison.OrdinalIgnoreCase) == true
            && item.PatchedSha256?.Equals(patchedHash, StringComparison.OrdinalIgnoreCase) == true))
            return;

        var lineage = backups
            .Where(item => item.Target.Equals(target, StringComparison.OrdinalIgnoreCase)
                && item.PatchedSha256?.Equals(originalHash, StringComparison.OrdinalIgnoreCase) == true
                && item.OriginalSha256 is not null
                && File.Exists(item.BackupFile))
            .OrderBy(item => item.CreatedAtUtc ?? DateTimeOffset.MinValue)
            .LastOrDefault();
        if (lineage is not null)
        {
            backups.Add(new AssetBackup(
                target,
                lineage.BackupFile,
                lineage.OriginalSha256,
                patchedHash,
                DateTimeOffset.UtcNow));
            return;
        }

        var assetBackupDir = Path.Combine(backupDir, "ggpk-assets");
        Directory.CreateDirectory(assetBackupDir);
        var backupFile = Path.Combine(
            assetBackupDir,
            $"{SafeName(target)}.{originalHash[..16]}.bin");

        if (File.Exists(backupFile))
        {
            if (!Sha256(File.ReadAllBytes(backupFile)).Equals(originalHash, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"File backup trùng tên nhưng sai SHA-256: {backupFile}");
        }
        else
        {
            var temporary = backupFile + ".tmp-" + Guid.NewGuid().ToString("N");
            try
            {
                File.WriteAllBytes(temporary, original);
                File.Move(temporary, backupFile, false);
            }
            finally
            {
                if (File.Exists(temporary))
                    File.Delete(temporary);
            }
        }

        backups.Add(new AssetBackup(target, backupFile, originalHash, patchedHash, DateTimeOffset.UtcNow));
    }

    private static void WriteJsonAtomically<T>(string path, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(value, JsonOptions), Encoding.UTF8);
            File.Move(temporary, path, true);
        }
        finally
        {
            if (File.Exists(temporary))
                File.Delete(temporary);
        }
    }

    private static void EnsureGameIsClosed(string target)
    {
        var targetDirectory = Path.GetDirectoryName(target) ?? string.Empty;
        var gameDirectory = Path.GetFileName(target).Equals("_.index.bin", StringComparison.OrdinalIgnoreCase)
            ? Directory.GetParent(targetDirectory)?.FullName ?? targetDirectory
            : targetDirectory;
        var expected = Path.GetFullPath(gameDirectory).TrimEnd('\\', '/');

        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                if (!process.ProcessName.StartsWith("PathOfExile", StringComparison.OrdinalIgnoreCase))
                    continue;
                string? directory;
                try
                {
                    var executable = process.MainModule?.FileName;
                    directory = executable is null ? null : Path.GetDirectoryName(executable);
                }
                catch
                {
                    // Ignore inaccessible/exited processes; Rust performs the same scoped preflight.
                    continue;
                }
                if (directory is not null
                    && Path.GetFullPath(directory).TrimEnd('\\', '/').Equals(expected, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException(
                        $"Path of Exile 2 đang chạy (PID {process.Id}); hãy thoát game trước khi apply/restore GGPK");
            }
        }
    }

    private static void ConfigureOodleResolver(string target)
    {
        var candidates = new List<string>
        {
            Path.Combine(AppContext.BaseDirectory, "oo2core.dll"),
            Path.Combine(Path.GetDirectoryName(target) ?? string.Empty, "oo2core.dll"),
            Path.Combine(Path.GetDirectoryName(target) ?? string.Empty, "oo2core_9_win64.dll"),
            Path.Combine(Path.GetDirectoryName(target) ?? string.Empty, "oo2core_8_win64.dll"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FindigoUltimate4P", "current", "oo2core.dll"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "oo2core_9_win64.dll"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "oo2core_8_win64.dll"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "oo2core_5_win64.dll")
        };
        var found = candidates.FirstOrDefault(File.Exists);
        if (found is null)
            return;

        NativeLibrary.SetDllImportResolver(typeof(LibBundle3.Oodle).Assembly, (name, assembly, searchPath) =>
        {
            if (name.Equals("oo2core", StringComparison.OrdinalIgnoreCase))
                return NativeLibrary.Load(found);
            return IntPtr.Zero;
        });
    }

    private static PatchResult? OpenIndex(string target, bool readOnly, out BundleIndex? index, out IDisposable? disposable)
    {
        index = null;
        disposable = null;
        try
        {
            if (target.EndsWith("Content.ggpk", StringComparison.OrdinalIgnoreCase))
            {
                var access = readOnly ? FileAccess.Read : FileAccess.ReadWrite;
                var share = readOnly ? FileShare.ReadWrite | FileShare.Delete : FileShare.Read;
                var stream = new FileStream(target, FileMode.Open, access, share);
                var ggpk = new BundledGGPK(stream, false, false);
                index = ggpk.Index;
                disposable = ggpk;
                return null;
            }

            index = new BundleIndex(target, false);
            disposable = index;
            return null;
        }
        catch (Exception ex)
        {
            disposable?.Dispose();
            return new PatchResult(false, false, "", [], [], "Không mở được asset container", ex.GetBaseException().Message);
        }
    }

    private static int Fail(string error) => Write(new PatchResult(false, false, "", [], [], "", error));

    private static int Write(PatchResult result)
    {
        Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
        return result.Ok ? 0 : 2;
    }
}
