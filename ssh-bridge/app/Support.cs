// Meow SSH Bridge —— 运行支撑：日志与子进程托管。
//
// 1) AppLog：把启动、异常、退出原因写到数据目录的 app.log，
//    这样“双击没反应”这类问题下次可以直接看日志定位。
// 2) ChildJob：把 bridge.exe 放进带 KILL_ON_JOB_CLOSE 的作业对象，
//    宿主进程无论以哪种方式结束（崩溃、被任务管理器结束、注销），
//    子进程都会被系统一并结束，不会残留占着 8765 端口。

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace MeowSshBridge
{
    internal static class AppLog
    {
        private static readonly object Sync = new object();
        private static string filePath;

        public static void Init(string dataDir)
        {
            try
            {
                filePath = Path.Combine(dataDir, "app.log");
                var info = new FileInfo(filePath);
                if (info.Exists && info.Length > 512 * 1024)
                {
                    File.Delete(filePath);
                }
            }
            catch (Exception)
            {
                filePath = null;
            }
        }

        public static void Write(string message)
        {
            if (filePath == null) return;
            try
            {
                lock (Sync)
                {
                    File.AppendAllText(filePath,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + message + Environment.NewLine,
                        Encoding.UTF8);
                }
            }
            catch (Exception) { /* ignore */ }
        }

        public static void Write(string message, Exception ex)
        {
            Write(message + "：" + (ex == null ? "(null)" : ex.GetType().Name + ": " + ex.Message));
            if (ex != null && ex.StackTrace != null)
            {
                Write("  " + ex.StackTrace.Replace(Environment.NewLine, " | "));
            }
        }
    }

    internal static class ChildJob
    {        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JobObjectLimitKillOnJobClose = 0x2000;

        private static IntPtr job = IntPtr.Zero;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr jobHandle, int infoClass,
            IntPtr jobObjectInfo, uint jobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr jobHandle, IntPtr processHandle);

        [StructLayout(LayoutKind.Sequential)]
        private struct JobBasicLimitInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobExtendedLimitInformation
        {
            public JobBasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        /// <summary>把子进程加入作业对象：宿主进程结束时系统自动结束它。</summary>
        public static bool Attach(Process process)
        {
            try
            {
                if (job == IntPtr.Zero)
                {
                    job = CreateJobObject(IntPtr.Zero, null);
                    if (job == IntPtr.Zero)
                    {
                        AppLog.Write("创建作业对象失败：" + Marshal.GetLastWin32Error());
                        return false;
                    }

                    var info = new JobExtendedLimitInformation();
                    info.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
                    int length = Marshal.SizeOf(typeof(JobExtendedLimitInformation));
                    IntPtr buffer = Marshal.AllocHGlobal(length);
                    try
                    {
                        Marshal.StructureToPtr(info, buffer, false);
                        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)length))
                        {
                            AppLog.Write("设置作业对象失败：" + Marshal.GetLastWin32Error());
                        }
                    }
                    finally
                    {
                        Marshal.FreeHGlobal(buffer);
                    }
                }

                if (!AssignProcessToJobObject(job, process.Handle))
                {
                    AppLog.Write("把桥接进程加入作业对象失败：" + Marshal.GetLastWin32Error());
                    return false;
                }
                return true;
            }
            catch (Exception ex)
            {
                AppLog.Write("作业对象处理异常", ex);
                return false;
            }
        }
    }

    /// <summary>
    /// 托盘可用性探测。某些环境（提权运行、安全软件、被托管的进程）会拒绝
    /// Shell_NotifyIcon，此时界面会完全不出现，必须降级为“任务栏模式”。
    /// </summary>
    internal static class TraySupport
    {
        private const uint NimAdd = 0;
        private const uint NimDelete = 2;
        private const uint NifMessage = 0x01;
        private const uint NifIcon = 0x02;
        private const uint NifTip = 0x04;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct NotifyIconData
        {
            public int cbSize;
            public IntPtr hWnd;
            public uint uID;
            public uint uFlags;
            public uint uCallbackMessage;
            public IntPtr hIcon;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
            public uint dwState;
            public uint dwStateMask;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
            public uint uTimeoutOrVersion;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
            public uint dwInfoFlags;
            public Guid guidItem;
            public IntPtr hBalloonIcon;
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool Shell_NotifyIcon(uint message, ref NotifyIconData data);

        /// <summary>试注册一个临时图标再删掉，用来判断当前进程能不能用托盘。</summary>
        public static bool Probe(IntPtr windowHandle, System.Drawing.Icon icon, out int error)
        {
            error = 0;
            try
            {
                var data = new NotifyIconData
                {
                    cbSize = Marshal.SizeOf(typeof(NotifyIconData)),
                    hWnd = windowHandle,
                    uID = 0xFEED,
                    uFlags = NifIcon | NifMessage | NifTip,
                    uCallbackMessage = 0x0400 + 0x51,
                    hIcon = icon == null ? IntPtr.Zero : icon.Handle,
                    szTip = "Meow SSH Bridge"
                };

                bool ok = Shell_NotifyIcon(NimAdd, ref data);
                if (!ok)
                {
                    error = Marshal.GetLastWin32Error();
                    return false;
                }

                Shell_NotifyIcon(NimDelete, ref data);
                return true;
            }
            catch (Exception ex)
            {
                AppLog.Write("托盘探测异常", ex);
                return false;
            }
        }
    }
}
