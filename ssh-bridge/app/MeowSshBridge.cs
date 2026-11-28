// Meow SSH Bridge —— 托盘版宿主程序。
//
// 设计：
//   * 启动后不显示窗口，只在通知区域（托盘）常驻一个图标；
//   * 双击托盘图标打开日志窗口，实时显示桥接进程的输出、地址和访问令牌；
//   * 关闭窗口只是隐藏，桥接继续运行；退出请用托盘菜单或窗口里的“退出”。
//
// 桥接本身是 Node 版 bridge-core.js 打包出的单文件 bridge.exe：
// 本程序把它作为子进程启动，通过 stdout/stderr 收集日志，通过 stdin 发送 quit 优雅退出。
// 优先使用与自身同目录的 bridge.exe；没有时从嵌入资源释放到数据目录后运行。

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace MeowSshBridge
{
    internal static class Program
    {
        private const string MutexName = @"Local\MeowSshBridge.SingleInstance";
        private const string ShowEventName = @"Local\MeowSshBridge.ShowWindow";

        [STAThread]
        private static void Main()
        {
            Application.ThreadException += (s, e) => ReportFatal(e.Exception);
            AppDomain.CurrentDomain.UnhandledException += (s, e) => ReportFatal(e.ExceptionObject as Exception);

            bool createdNew;
            using (var mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    // 已有实例在托盘运行：通知它显示窗口，然后退出。
                    bool signalled = false;
                    try
                    {
                        using (var ev = EventWaitHandle.OpenExisting(ShowEventName))
                        {
                            ev.Set();
                            signalled = true;
                        }
                    }
                    catch (Exception)
                    {
                        // 对方可能仍在启动中
                    }

                    if (!signalled)
                    {
                        MessageBox.Show(
                            "Meow SSH Bridge 已经在后台运行。\n\n" +
                            "请在任务栏通知区域（右下角，必要时点 ^ 展开）找到红色猫图标，双击打开日志窗口。",
                            "Meow SSH Bridge", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                    return;
                }

                string dataDir = TrayContext.ResolveDataDir();
                AppLog.Init(dataDir);
                AppLog.Write("==== 启动 (数据目录: " + dataDir + ")");

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayContext(dataDir));

                AppLog.Write("==== 已退出");
                GC.KeepAlive(mutex);
            }
        }

        private static void ReportFatal(Exception ex)
        {
            AppLog.Write("未处理异常", ex);
            try
            {
                MessageBox.Show(
                    "Meow SSH Bridge 遇到错误：\n" + (ex == null ? "未知错误" : ex.Message) +
                    "\n\n详细信息已写入数据目录的 app.log。",
                    "Meow SSH Bridge", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch (Exception) { /* ignore */ }
        }
    }

    internal sealed class LogEntry
    {
        public DateTime Time;
        public string Level;
        public string Text;
    }

    /// <summary>负责启动/停止 bridge.exe，并把它的输出转成日志事件。</summary>
    internal sealed class BridgeHost : IDisposable
    {
        private readonly object sync = new object();
        private Process process;
        private bool stopping;

        public int Port;
        public string DataDir;
        public string BridgePath;
        public string Address;
        public string Token;

        public event Action<LogEntry> Line;
        public event Action StateChanged;
        public event Action Ready;
        /// <summary>桥接无法启动或意外退出时触发，宿主据此自动弹窗，避免“双击没反应”。</summary>
        public event Action<string> Failed;

        public bool Running
        {
            get
            {
                lock (sync)
                {
                    try
                    {
                        return process != null && !process.HasExited;
                    }
                    catch (Exception)
                    {
                        return false;
                    }
                }
            }
        }

        public void Start()
        {
            if (Running) return;

            string exe = ResolveBridgeExe();
            if (exe == null)
            {
                const string reason = "找不到 bridge.exe，无法启动桥接。请重新下载完整的程序。";
                Emit("error", reason);
                RaiseFailed(reason);
                return;
            }

            var psi = new ProcessStartInfo(exe)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                WorkingDirectory = Path.GetDirectoryName(exe)
            };
            psi.Arguments = "--port " + Port.ToString(CultureInfo.InvariantCulture) +
                            " --data-dir \"" + DataDir + "\"";

            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            proc.OutputDataReceived += (s, e) => { if (e.Data != null) HandleLine(e.Data); };
            proc.ErrorDataReceived += (s, e) => { if (e.Data != null) HandleLine(e.Data); };
            proc.Exited += (s, e) =>
            {
                bool unexpected;
                lock (sync)
                {
                    // 只关心“当前这个子进程”的退出，且不是我们主动停的
                    unexpected = !stopping && ReferenceEquals(process, proc);
                }

                if (unexpected)
                {
                    const string reason = "桥接进程意外退出（最常见原因：端口被其他程序占用）。已打开日志窗口，可在上方换个端口重试。";
                    Emit("error", "桥接进程已退出。");
                    AppLog.Write("桥接子进程意外退出，退出码 " + SafeExitCode(proc));
                    RaiseStateChanged();
                    RaiseFailed(reason);
                    return;
                }

                Emit("warn", "桥接已停止。");
                RaiseStateChanged();
            };

            lock (sync)
            {
                process = proc;
                stopping = false;
            }

            try
            {
                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                ChildJob.Attach(proc);
                AppLog.Write("已启动桥接子进程 pid=" + proc.Id + " 端口=" + Port);
                Emit("info", "正在启动桥接（端口 " + Port + "）...");
            }
            catch (Exception ex)
            {
                Emit("error", "启动 bridge.exe 失败：" + ex.Message);
                AppLog.Write("启动 bridge.exe 失败", ex);
                lock (sync) { process = null; }
                RaiseStateChanged();
                RaiseFailed("启动 bridge.exe 失败：" + ex.Message);
                return;
            }

            RaiseStateChanged();
        }

        public void Stop()
        {
            Process proc;
            lock (sync)
            {
                proc = process;
                stopping = true;
            }
            if (proc == null) return;

            try
            {
                if (!proc.HasExited)
                {
                    // 让桥接先清理 SSH 会话并释放端口，再退出。
                    proc.StandardInput.WriteLine("quit");
                    proc.StandardInput.Flush();
                    if (!proc.WaitForExit(2000))
                    {
                        proc.Kill();
                    }
                }
            }
            catch (Exception)
            {
                try { proc.Kill(); } catch (Exception) { /* ignore */ }
            }

            lock (sync)
            {
                process = null;
            }
            RaiseStateChanged();
        }

        public void Restart(int port)
        {
            Port = port;
            Stop();
            Start();
        }

        private string ResolveBridgeExe()
        {
            if (!string.IsNullOrEmpty(BridgePath) && File.Exists(BridgePath)) return BridgePath;

            // 1) 与宿主程序同目录
            string beside = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bridge.exe");
            if (File.Exists(beside)) return beside;

            // 2) 从嵌入资源释放一次（按版本区分，升级后自动更新）
            string targetDir = Path.Combine(DataDir, "runtime-" + AppVersion());
            string target = Path.Combine(targetDir, "bridge.exe");
            if (File.Exists(target) && new FileInfo(target).Length > 1024 * 1024) return target;

            try
            {
                Directory.CreateDirectory(targetDir);
                using (Stream res = Assembly.GetExecutingAssembly().GetManifestResourceStream("bridge.exe"))
                {
                    if (res == null) return null;
                    using (var fs = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        res.CopyTo(fs);
                    }
                }
                return target;
            }
            catch (Exception ex)
            {
                Emit("error", "释放内置 bridge.exe 失败：" + ex.Message);
                return null;
            }
        }

        public static string AppVersion()
        {
            try
            {
                return Assembly.GetExecutingAssembly().GetName().Version.ToString();
            }
            catch (Exception)
            {
                return "1.0.0.0";
            }
        }

        private void HandleLine(string raw)
        {
            if (raw.StartsWith("[meow-bridge-ready]", StringComparison.Ordinal))
            {
                string body = raw.Substring("[meow-bridge-ready]".Length).Trim();
                foreach (string part in body.Split(' '))
                {
                    int eq = part.IndexOf('=');
                    if (eq <= 0) continue;
                    string key = part.Substring(0, eq);
                    string value = part.Substring(eq + 1);
                    if (key == "address") Address = value;
                    else if (key == "token") Token = value;
                }
                Emit("success", "桥接已就绪：" + (Address ?? ("ws://127.0.0.1:" + Port)));
                var handler = Ready;
                if (handler != null) handler();
                RaiseStateChanged();
                return;
            }

            string level = "info";
            string text = raw;
            if (raw.StartsWith("[") && raw.IndexOf("] ", StringComparison.Ordinal) > 1)
            {
                int end = raw.IndexOf("] ", StringComparison.Ordinal);
                level = raw.Substring(1, end - 1);
                text = raw.Substring(end + 2);
            }
            Emit(level, text);
        }

        private void Emit(string level, string text)
        {
            var handler = Line;
            if (handler == null) return;
            handler(new LogEntry { Time = DateTime.Now, Level = level, Text = text });
        }

        private void RaiseStateChanged()
        {
            var handler = StateChanged;
            if (handler != null) handler();
        }

        private void RaiseFailed(string reason)
        {
            var handler = Failed;
            if (handler != null) handler(reason);
        }

        private static string SafeExitCode(Process p)
        {
            try { return p.ExitCode.ToString(CultureInfo.InvariantCulture); }
            catch (Exception) { return "?"; }
        }

        public void Dispose()
        {
            Stop();
        }
    }

    /// <summary>托盘 + 日志窗口。</summary>
    internal sealed class TrayContext : ApplicationContext
    {
        private readonly NotifyIcon tray;
        private readonly BridgeHost bridge;
        private readonly List<LogEntry> buffer = new List<LogEntry>();
        private readonly Icon appIcon;
        private LogForm form;
        private readonly Form uiAnchor;
        private readonly bool trayAvailable;
        private int port;
        private string dataDir;

        public TrayContext(string dataDirArg)
        {
            appIcon = LoadIcon();
            dataDir = dataDirArg;
            port = LoadPort();

            // 无界面的窗口，仅用于把一个窗口句柄固定绑定在 UI 线程上，
            // 供子进程事件（线程池线程）安全地找回 UI 线程。
            uiAnchor = new Form
            {
                ShowInTaskbar = false,
                FormBorderStyle = FormBorderStyle.None,
                StartPosition = FormStartPosition.Manual,
                Location = new Point(-32000, -32000),
                Size = new Size(1, 1)
            };
            IntPtr anchorHandle = uiAnchor.Handle;
            GC.KeepAlive(anchorHandle);

            // 先探测系统是否允许本进程注册托盘图标。
            // 被拒绝时（提权运行、安全软件拦截等）界面会完全不可见，必须降级为任务栏模式。
            int trayError;
            trayAvailable = TraySupport.Probe(uiAnchor.Handle, appIcon, out trayError);
            AppLog.Write("托盘图标探测：" + (trayAvailable ? "可用" : "被系统拒绝（Win32 错误 " + trayError + "）"));

            bridge = new BridgeHost { Port = port, DataDir = dataDir };
            bridge.Line += OnLine;
            bridge.StateChanged += OnStateChanged;
            bridge.Ready += OnReady;
            bridge.Failed += OnBridgeFailed;

            var menu = new ContextMenuStrip();
            menu.Items.Add(new ToolStripMenuItem("打开日志窗口", null, (s, e) => ShowWindow()));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("复制地址", null, (s, e) => CopyAddress()));
            menu.Items.Add(new ToolStripMenuItem("复制令牌", null, (s, e) => CopyToken()));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("重启桥接", null, (s, e) => bridge.Restart(port)));
            menu.Items.Add(new ToolStripMenuItem("打开数据目录", null, (s, e) => OpenDataDir()));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("退出", null, (s, e) => Quit()));

            tray = new NotifyIcon
            {
                Icon = appIcon,
                Visible = true,
                Text = "Meow SSH Bridge",
                ContextMenuStrip = menu
            };
            tray.DoubleClick += (s, e) => ShowWindow();
            tray.Click += (s, e) => ShowWindow();

            var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\MeowSshBridge.ShowWindow");
            ThreadPool.RegisterWaitForSingleObject(showEvent, (state, timedOut) => ShowWindow(), null, Timeout.Infinite, false);

            bridge.Start();
            ShowBalloon();

            // 带 --show 启动时直接打开日志窗口（方便排查问题）。
            if (Array.IndexOf(Environment.GetCommandLineArgs(), "--show") >= 0)
            {
                ShowWindow();
            }

            if (!trayAvailable)
            {
                AppendLog(new LogEntry
                {
                    Time = DateTime.Now,
                    Level = "warn",
                    Text = "托盘图标注册被拒绝（Win32 错误 " + trayError + "）。最常见原因是程序以低完整性级别启动——" +
                            "exe 放在 F: 等工作区/映射盘上就会这样。把 exe 复制到 C 盘（例如 %LOCALAPPDATA%\\MeowSshBridge）再运行，" +
                            "托盘图标会正常出现。现在先切到任务栏模式：关闭窗口会最小化到任务栏，点任务栏上的 Meow SSH Bridge 即可重新打开。"
                });
                ShowWindowMinimized();
            }
        }

        private Icon LoadIcon()
        {
            try
            {
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("icon.ico"))
                {
                    if (stream != null) return new Icon(stream);
                }
            }
            catch (Exception) { /* fall through */ }
            return SystemIcons.Application;
        }

        /// <summary>把操作切回 UI 线程。在非 UI 线程上创建窗体，界面会无法响应消息（看起来就是“假死”）。</summary>
        private void UiThread(Action action)
        {
            if (action == null) return;
            try
            {
                if (uiAnchor.InvokeRequired)
                {
                    uiAnchor.BeginInvoke(action);
                }
                else
                {
                    action();
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("切回 UI 线程失败", ex);
            }
        }

        private void ShowBalloon()
        {
            try
            {
                tray.ShowBalloonTip(4000, "Meow SSH Bridge",
                    "已在托盘后台运行，双击图标查看运行日志、地址和令牌。", ToolTipIcon.Info);
            }
            catch (Exception) { /* ignore */ }
            AppendLog(new LogEntry
            {
                Time = DateTime.Now,
                Level = "info",
                Text = "程序已在托盘常驻，双击图标查看日志；关闭窗口不会退出。"
            });
        }

        private void OnLine(LogEntry entry)
        {
            AppendLog(entry);
        }

        private void AppendLog(LogEntry entry)
        {
            lock (buffer)
            {
                buffer.Add(entry);
                if (buffer.Count > 2000) buffer.RemoveRange(0, buffer.Count - 2000);
            }
            if (form != null && !form.IsDisposed)
            {
                form.Append(entry);
            }
        }

        /// <summary>桥接没起来时主动把窗口弹出来，否则用户只会觉得“双击没反应”。</summary>
        private void OnBridgeFailed(string reason)
        {
            AppLog.Write("桥接失败：" + reason);
            AppendLog(new LogEntry { Time = DateTime.Now, Level = "error", Text = reason });
            UiThread(() =>
            {
                ShowWindowCore();
                try
                {
                    tray.ShowBalloonTip(5000, "Meow SSH Bridge 未启动", reason, ToolTipIcon.Error);
                }
                catch (Exception) { /* ignore */ }
            });
        }

        private void OnReady()
        {
            // 数据目录可能被安全策略限制为只读，此时令牌只能从窗口里复制。
            try
            {
                string tokenFile = Path.Combine(dataDir, ".bridge-token");
                if (!string.IsNullOrEmpty(bridge.Token) && !File.Exists(tokenFile))
                {
                    AppendLog(new LogEntry
                    {
                        Time = DateTime.Now,
                        Level = "warn",
                        Text = "数据目录不可写（" + dataDir + "），令牌只显示在窗口里，重启后会变化。"
                    });
                }
            }
            catch (Exception) { /* ignore */ }

            UiThread(RefreshStatus);
        }

        private void OnStateChanged()
        {
            UiThread(RefreshStatus);
        }

        private void RefreshStatus()
        {
            string token = CurrentToken();

            if (form != null && !form.IsDisposed)
            {
                form.UpdateStatus(bridge.Running, bridge.Address ?? ("ws://127.0.0.1:" + port), token);
            }
            UpdateTooltip();
        }

        /// <summary>桥接已就绪时用进程报告的值，未就绪时退回数据目录里保存的令牌。</summary>
        private string CurrentToken()
        {
            string token = bridge.Token;
            if (string.IsNullOrEmpty(token)) token = ReadTokenFile();
            return token;
        }

        /// <summary>启动失败时也要能显示令牌（稳定存在数据目录里）。</summary>
        private string ReadTokenFile()
        {
            try
            {
                string file = Path.Combine(dataDir, ".bridge-token");
                if (File.Exists(file))
                {
                    string value = File.ReadAllText(file).Trim();
                    return value.Length > 0 ? value : null;
                }
            }
            catch (Exception) { /* ignore */ }
            return null;
        }

        private void UpdateTooltip()
        {
            try
            {
                string text = bridge.Running
                    ? "Meow SSH Bridge\r\n" + (bridge.Address ?? ("ws://127.0.0.1:" + port))
                    : "Meow SSH Bridge\r\n桥接未运行，双击查看日志";
                tray.Text = text.Length > 63 ? text.Substring(0, 63) : text;
            }
            catch (Exception) { /* ignore */ }
        }

        private void ShowWindow()
        {
            UiThread(ShowWindowCore);
        }

        /// <summary>托盘不可用时，启动后直接以最小化形式留在任务栏，保证随时能找到窗口。</summary>
        private void ShowWindowMinimized()
        {
            UiThread(() =>
            {
                ShowWindowCore();
                if (form != null && !form.IsDisposed) form.WindowState = FormWindowState.Minimized;
            });
        }

        private void ShowWindowCore()
        {
            if (form == null || form.IsDisposed)
            {
                form = new LogForm(this, appIcon) { MinimizeInsteadOfHide = !trayAvailable };
                form.SetPort(port);
                form.UpdateStatus(bridge.Running, bridge.Address ?? ("ws://127.0.0.1:" + port), CurrentToken());
                lock (buffer)
                {
                    form.LoadEntries(buffer);
                }
            }

            if (!form.Visible) form.Show();
            if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
            form.Activate();
            form.BringToFront();
        }

        public void ApplyPort(int newPort)
        {
            if (newPort < 1 || newPort > 65535) return;
            port = newPort;
            SavePort(newPort);
            bridge.Restart(newPort);
        }

        public void RestartBridge()
        {
            bridge.Restart(port);
        }

        public void ClearLog()
        {
            lock (buffer) { buffer.Clear(); }
        }

        public void HideWindow()
        {
            if (form != null && !form.IsDisposed) form.Hide();
        }

        public void CopyAddress()
        {
            SetClipboard(bridge.Address ?? ("ws://127.0.0.1:" + port));
        }

        public void CopyToken()
        {
            string token = CurrentToken();
            if (!string.IsNullOrEmpty(token)) SetClipboard(token);
        }

        private static void SetClipboard(string text)
        {
            try { Clipboard.SetText(text); } catch (Exception) { /* ignore */ }
        }

        public void OpenDataDir()
        {
            try { Process.Start("explorer.exe", "\"" + dataDir + "\""); } catch (Exception) { /* ignore */ }
        }

        public void Quit()
        {
            AppLog.Write("用户选择退出");
            tray.Visible = false;
            bridge.Dispose();
            if (form != null && !form.IsDisposed)
            {
                form.AllowClose = true;
                form.Close();
            }
            tray.Dispose();
            try { uiAnchor.Dispose(); } catch (Exception) { /* ignore */ }
            ExitThread();
        }

        private int LoadPort()
        {
            try
            {
                string file = Path.Combine(dataDir, "config.txt");
                if (File.Exists(file))
                {
                    int value;
                    if (int.TryParse(File.ReadAllText(file).Trim(), out value) && value >= 1 && value <= 65535)
                    {
                        return value;
                    }
                }
            }
            catch (Exception) { /* ignore */ }
            return 8765;
        }

        private void SavePort(int value)
        {
            try
            {
                File.WriteAllText(Path.Combine(dataDir, "config.txt"), value.ToString(CultureInfo.InvariantCulture));
            }
            catch (Exception) { /* ignore */ }
        }

        /// <summary>依次探测可用数据目录：exe 同目录 → 本地应用数据 → 临时目录。</summary>
        internal static string ResolveDataDir()
        {
            var candidates = new List<string>
            {
                // 优先便携模式：数据放在 exe 同目录，换机器拷走整个文件夹即可。
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MeowSshBridge"),
                Path.Combine(Path.GetTempPath(), "MeowSshBridge")
            };

            foreach (string dir in candidates)
            {
                try
                {
                    Directory.CreateDirectory(dir);
                    string probe = Path.Combine(dir, ".write-test");
                    File.WriteAllText(probe, "ok");
                    File.Delete(probe);
                    return dir;
                }
                catch (Exception) { /* 试下一个 */ }
            }
            return candidates[candidates.Count - 1];
        }
    }
}
