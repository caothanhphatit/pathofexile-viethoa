using System.Globalization;
using System.Text.RegularExpressions;

internal sealed record MinimapTextPatch(
    string Data,
    bool Changed,
    bool Already,
    string? Error = null);

/// <summary>
/// Applies the PoE 2 readable-layout minimap transform. The transform exposes
/// the walkable outline while deliberately preserving the game's exploration
/// visibility/fog state. It is text-structure based so a game update fails
/// closed when the expected shader statements are no longer present.
/// </summary>
internal static class MinimapLayoutPatch
{
    private const string VisibilityMarker = "// POEVH minimap: preserve exploration visibility.";
    private const string WalkableVisibilityMarker = "// POEVH minimap: preserve walkable exploration visibility.";
    private const string OutlineMarker = "// POEVH minimap: reveal readable walkable outline.";
    private const string GeometryMarker = "// POEVH minimap: hide non-layout geometry.";
    private const string DecorationMarker = "// POEVH minimap: hide non-layout edge decoration.";

    private static readonly Regex FullyRevealedBlock = new(
        @"if\s*\(\s*visibility_fully_revealed\s*>\s*0\.5f\s*\)\s*\r?\n\s*res_color\s*=\s*float4\s*\(\s*1\.0f\s*,\s*0\.0f\s*,\s*0\.0f\s*,\s*1\.0f\s*\)\s*;",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex WalkableRevealAssignment = new(
        @"(?<prefix>if\s*\(\s*visibility_walkable_revealed\s*>\s*0\.5f\s*\)\s*\{[\s\S]*?)res_color\s*=\s*float4\s*\(\s*max\s*\(\s*prev_ratio\s*,\s*res_ratio\s*\)\s*,\s*0\.0f\s*,\s*0\.0f\s*,\s*1\.0f\s*\)\s*;",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex BaseWalkabilityColor = new(
        @"float4\s+walkability_map_color\s*=\s*lerp\s*\(\s*walkable_color\s*,\s*float4\s*\([^)]+\)\s*,\s*walkable_to_edge_ratio\s*\)\s*;",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex PatchedWalkabilityColor = new(
        @"(?:" + Regex.Escape(OutlineMarker) + @"\s*)?float4\s+walkability_map_color\s*=\s*lerp\s*\(\s*walkable_color\s*,\s*lerp\s*\(\s*float4\s*\([^)]+\)\s*,\s*float4\s*\([^)]+\)\s*,\s*saturate\s*\(\s*walkability_sample\.g\s*\*\s*2\.0f\s*\)\s*\)\s*,\s*walkable_to_edge_ratio\s*\)\s*;",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex BaseFogBlend = new(
        @"walkability_map_color\s*=\s*lerp\s*\(\s*walkability_map_color\s*\*\s*float4\s*\(\s*1\.0f\s*,\s*1\.0f\s*,\s*1\.0f\s*,\s*visibility\s*\)\s*,\s*float4\s*\(\s*0\.0f\s*,\s*0\.5f\s*,\s*1\.0f\s*,\s*0\.5f\s*\)\s*,\s*pow\s*\(\s*saturate\s*\(\s*unexplored_edge\s*\)\s*,\s*25\.0f\s*\)\s*\)\s*;",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex GeometryFade = new(
        @"geometry_sample\.a\s*=\s*lerp\s*\(\s*geometry_sample\.a\s*,\s*geometry_sample\.a\s*\*\s*max_walkable_fade\s*,\s*\(\s*1\.0f\s*-\s*edge_to_unwalkable_ratio\s*\)\s*\)\s*;",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex GeometryBlend = new(
        @"res_color\s*=\s*Uberblend\s*\(\s*res_color\s*,\s*geometry_sample\s*\*\s*float4\s*\(\s*1\.0f\s*,\s*1\.0f\s*,\s*1\.0f\s*,\s*\w+\s*\)\s*\)\s*;",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex EncounterVisibilityDeclaration = new(
        @"\s*float\s+encounter_visibility\s*=\s*1\.0f\s*;\s*\r?\n",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex DecayEdgeAddition = new(
        @"res_color\.rgb\s*\+=\s*decay_edge_color\.rgb(?:\s*\*\s*\(\s*1\.0f\s*-\s*edge_to_unwalkable_ratio\s*\))?\s*;",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex SynthesisMask = new(
        @"res_color\.a\s*\*=\s*saturate\s*\(\s*1\.0f\s*-\s*walkability_sample\.b\s*\*\s*2\.0f\s*\)\s*;",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex ColorDeclaration = new(
        @"(?<prefix>\bfloat4\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*)float4\([^)]+\)(?<suffix>\s*;)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex AntiAliasWidth = new(
        @"float\s+aa_width\s*=\s*(?:2e-1f|8e-2f|0\.08f|0\.2f|0\.3f)\s*;",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static MinimapTextPatch TransformVisibility(string source)
    {
        if (string.IsNullOrEmpty(source))
            return Unsupported(source, "Minimap visibility shader is empty.");

        var hasFullMarker = source.Contains(VisibilityMarker, StringComparison.Ordinal);
        var hasWalkableMarker = source.Contains(WalkableVisibilityMarker, StringComparison.Ordinal);
        if (hasFullMarker && hasWalkableMarker)
            return new MinimapTextPatch(source, false, true);

        var transformed = source;
        var matched = false;
        if (!hasFullMarker && FullyRevealedBlock.IsMatch(transformed))
        {
            transformed = FullyRevealedBlock.Replace(transformed, VisibilityMarker, 1);
            matched = true;
        }
        if (!hasWalkableMarker && WalkableRevealAssignment.IsMatch(transformed))
        {
            transformed = WalkableRevealAssignment.Replace(
                transformed,
                match => match.Groups["prefix"].Value + WalkableVisibilityMarker,
                1);
            matched = true;
        }

        if (!matched && !hasFullMarker && !hasWalkableMarker)
            return Unsupported(source, "Minimap visibility shader no longer contains the supported PoE 2 reveal structure.");

        return new MinimapTextPatch(transformed, transformed != source, false);
    }

    public static MinimapTextPatch TransformBlending(
        string source,
        float outlineOpacity = 1.0f,
        bool widenOutline = true)
    {
        if (string.IsNullOrEmpty(source))
            return Unsupported(source, "Minimap blending shader is empty.");

        outlineOpacity = Math.Clamp(outlineOpacity, 0.0f, 1.0f);
        var transformed = source;
        var recognizedCore = false;

        var outlineLine = BuildOutlineColorLine(outlineOpacity);
        if (PatchedWalkabilityColor.IsMatch(transformed))
        {
            recognizedCore = true;
            transformed = PatchedWalkabilityColor.Replace(transformed, OutlineMarker + Environment.NewLine + "\t" + outlineLine, 1);
        }
        else if (BaseWalkabilityColor.IsMatch(transformed))
        {
            recognizedCore = true;
            transformed = BaseWalkabilityColor.Replace(transformed, OutlineMarker + Environment.NewLine + "\t" + outlineLine, 1);
        }

        if (transformed.Contains("float layout_visibility = max(visibility, walkable_to_edge_ratio);", StringComparison.Ordinal))
        {
            recognizedCore = true;
        }
        else if (BaseFogBlend.IsMatch(transformed))
        {
            recognizedCore = true;
            transformed = BaseFogBlend.Replace(transformed, BuildFogOutlineBlock(), 1);
        }

        if (!recognizedCore)
            return Unsupported(source, "Minimap blending shader no longer contains the supported PoE 2 walkability/fog structure.");

        if (widenOutline)
            transformed = AntiAliasWidth.Replace(transformed, "float aa_width = 0.3f;", 1);

        if (!transformed.Contains("geometry_sample.a = lerp(geometry_sample.a * max_walkable_fade, 0.0f, edge_to_unwalkable_ratio);", StringComparison.Ordinal))
        {
            transformed = GeometryFade.Replace(
                transformed,
                "geometry_sample.a = lerp(geometry_sample.a * max_walkable_fade, 0.0f, edge_to_unwalkable_ratio);",
                1);
        }

        if (!transformed.Contains(DecorationMarker, StringComparison.Ordinal))
            transformed = DecayEdgeAddition.Replace(transformed, DecorationMarker, 1);

        if (!transformed.Contains(GeometryMarker, StringComparison.Ordinal))
        {
            transformed = EncounterVisibilityDeclaration.Replace(transformed, Environment.NewLine, 1);
            transformed = GeometryBlend.Replace(transformed, GeometryMarker, 1);
        }

        const string synthesisMask = "res_color.a *= saturate(1.0f - walkability_sample.b * 2.0f) * (1.0f - edge_to_unwalkable_ratio);";
        if (!transformed.Contains(synthesisMask, StringComparison.Ordinal))
            transformed = SynthesisMask.Replace(transformed, synthesisMask, 1);

        transformed = ColorDeclaration.Replace(transformed, match =>
        {
            var name = match.Groups["name"].Value;
            if (name.Equals("walkable_color", StringComparison.OrdinalIgnoreCase)
                || name.Equals("walkability_map_color", StringComparison.OrdinalIgnoreCase))
                return match.Value;
            return match.Groups["prefix"].Value + "float4(0, 0, 0, 0)" + match.Groups["suffix"].Value;
        });

        var already = transformed == source
            && source.Contains(OutlineMarker, StringComparison.Ordinal)
            && source.Contains("float layout_visibility = max(visibility, walkable_to_edge_ratio);", StringComparison.Ordinal);
        return new MinimapTextPatch(transformed, transformed != source, already);
    }

    private static string BuildOutlineColorLine(float opacity)
    {
        var alpha = opacity.ToString("0.0##", CultureInfo.InvariantCulture) + "f";
        return "float4 walkability_map_color = lerp(walkable_color, "
            + "lerp(float4(0.5f, 0.5f, 1.0f, 0.5f), "
            + $"float4(1.0f, 1.0f, 1.0f, {alpha}), "
            + "saturate(walkability_sample.g * 2.0f)), walkable_to_edge_ratio);";
    }

    private static string BuildFogOutlineBlock() =>
        "float walkable_mask = 1.0f - edge_to_unwalkable_ratio;" + Environment.NewLine
        + "\tfloat layout_visibility = max(visibility, walkable_to_edge_ratio);" + Environment.NewLine
        + "\twalkability_map_color = lerp(walkability_map_color * float4(1.0f, 1.0f, 1.0f, layout_visibility), "
        + "float4(0.0f, 0.5f, 1.0f, 0.5f), pow(saturate(unexplored_edge), 25.0f));" + Environment.NewLine
        + "\twalkability_map_color.a *= walkable_mask;";

    private static MinimapTextPatch Unsupported(string source, string error) =>
        new(source, false, false, error);
}
