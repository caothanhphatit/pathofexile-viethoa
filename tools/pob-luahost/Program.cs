// Minimal `luajit script.lua [args...]` replacement that runs on Path of Building's own
// runtime/lua51.dll. PoB ships a patched LuaJIT (`x += 1`, `a?.b`, `continue`), so a stock
// luajit.exe cannot parse its sources, and stock luajit.exe cannot load PoB's DLL either
// (different luaJIT_version_* export). Used by `npm run server` on Windows dev machines:
//   POB_LUAJIT=<pob-core>/runtime/pob-luajit.exe POB_CORE_DIR=<pob-core>/src
//
// The DLL is found next to this exe, in POB_RUNTIME_DIR, or in ../runtime relative to the
// working directory (the backend runs calculate.lua with cwd = <pob-core>/src).
using System.Runtime.InteropServices;
using System.Text;

internal static class Program
{
    private const int LUA_GLOBALSINDEX = -10002;
    private const int LUA_MULTRET = -1;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr NewState();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void OpenLibs(IntPtr L);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int LoadFile(IntPtr L, byte[] path);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int PCall(IntPtr L, int nargs, int nresults, int errfunc);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void CreateTable(IntPtr L, int narr, int nrec);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void PushString(IntPtr L, byte[] s);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void RawSetI(IntPtr L, int idx, int n);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void SetField(IntPtr L, int idx, byte[] k);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr ToLString(IntPtr L, int idx, out UIntPtr len);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void Close(IntPtr L);

    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetDllDirectory(string path);

    private static byte[] Z(string s) => Encoding.UTF8.GetBytes(s + "\0");

    private static string? FindRuntime()
    {
        var candidates = new[]
        {
            Environment.GetEnvironmentVariable("POB_RUNTIME_DIR"),
            AppContext.BaseDirectory,
            Path.Combine(Directory.GetCurrentDirectory(), "..", "runtime")
        };
        return candidates
            .Where(dir => !string.IsNullOrEmpty(dir))
            .Select(dir => Path.GetFullPath(dir!))
            .FirstOrDefault(dir => File.Exists(Path.Combine(dir, "lua51.dll")));
    }

    private static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.Error.WriteLine("usage: pob-luajit script.lua [args...]");
            return 2;
        }
        var runtime = FindRuntime();
        if (runtime is null)
        {
            Console.Error.WriteLine("pob-luajit: PoB runtime/lua51.dll not found (set POB_RUNTIME_DIR)");
            return 2;
        }
        // Dependent DLLs (lua-utf8.dll, msvcr*, ...) resolve from the runtime folder.
        SetDllDirectory(runtime);
        var lib = NativeLibrary.Load(Path.Combine(runtime, "lua51.dll"));
        T F<T>(string name) where T : Delegate => Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(lib, name));

        var newState = F<NewState>("luaL_newstate");
        var openLibs = F<OpenLibs>("luaL_openlibs");
        var loadFile = F<LoadFile>("luaL_loadfile");
        var pcall = F<PCall>("lua_pcall");
        var createTable = F<CreateTable>("lua_createtable");
        var pushString = F<PushString>("lua_pushstring");
        var rawSetI = F<RawSetI>("lua_rawseti");
        var setField = F<SetField>("lua_setfield");
        var toLString = F<ToLString>("lua_tolstring");
        var close = F<Close>("lua_close");

        var L = newState();
        openLibs(L);

        // arg[0] = script, arg[1..n] = script arguments (what `luajit script.lua ...` provides).
        createTable(L, args.Length, 1);
        for (var i = 0; i < args.Length; i++)
        {
            pushString(L, Z(args[i]));
            rawSetI(L, -2, i);
        }
        setField(L, LUA_GLOBALSINDEX, Z("arg"));

        var status = loadFile(L, Z(args[0]));
        if (status == 0)
        {
            for (var i = 1; i < args.Length; i++) pushString(L, Z(args[i]));
            status = pcall(L, args.Length - 1, LUA_MULTRET, 0);
        }
        if (status != 0)
        {
            var ptr = toLString(L, -1, out var len);
            var message = ptr == IntPtr.Zero ? "(error object is not a string)" : Marshal.PtrToStringUTF8(ptr, (int)len);
            Console.Out.Flush();
            Console.Error.WriteLine($"pob-luajit: {message}");
            close(L);
            return 1;
        }
        close(L);
        return 0;
    }
}
