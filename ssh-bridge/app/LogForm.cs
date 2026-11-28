// Meow SSH Bridge —— 日志窗口。
// 深色界面：顶部状态、地址/令牌（可复制）、端口切换、实时运行日志。

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

namespace MeowSshBridge
{
    internal sealed class LogForm : Form
    {
        private static readonly Color Bg = Color.FromArgb(20, 20, 22);
        private static readonly Color Panel = Color.FromArgb(28, 28, 32);
        private static readonly Color Line = Color.FromArgb(46, 46, 53);
        private static readonly Color TextColor = Color.FromArgb(230, 230, 234);
        private static readonly Color Muted = Color.FromArgb(139, 139, 150);
        private static readonly Color Accent = Color.FromArgb(224, 52, 42);
        private static readonly Color Ok = Color.FromArgb(78, 201, 160);
        private static readonly Color WarnColor = Color.FromArgb(229, 177, 60);
        private static readonly Color ErrorColor = Color.FromArgb(239, 83, 80);

        private readonly TrayContext owner;
        private readonly Label statusDot;
        private readonly Label statusText;
        private readonly TextBox addressBox;
        private readonly TextBox tokenBox;
        private readonly TextBox portBox;
        private readonly RichTextBox logBox;
        private readonly CheckBox autoScroll;

        public bool AllowClose;
        public int CurrentPort = 8765;
        /// <summary>托盘不可用时，关闭按钮改为最小化到任务栏。</summary>
        public bool MinimizeInsteadOfHide;

        public LogForm(TrayContext owner, Icon icon)
        {
            this.owner = owner;

            Text = "Meow SSH Bridge — 运行日志";
            Icon = icon;
            BackColor = Bg;
            ForeColor = TextColor;
            Font = new Font("Microsoft YaHei UI", 9f);
            MinimumSize = new Size(680, 480);
            ClientSize = new Size(820, 600);
            StartPosition = FormStartPosition.CenterScreen;
            DoubleBuffered = true;

            // ---------- 顶部 ----------
            var header = new Panel { Dock = DockStyle.Top, Height = 58, BackColor = Bg };

            var logo = new PictureBox
            {
                Image = LoadLogo(icon),
                SizeMode = PictureBoxSizeMode.Zoom,
                Bounds = new Rectangle(14, 12, 32, 32)
            };

            var title = new Label
            {
                Text = "Meow SSH Bridge",
                Font = new Font("Microsoft YaHei UI", 11.5f, FontStyle.Bold),
                ForeColor = TextColor,
                AutoSize = true,
                Location = new Point(56, 10)
            };

            var subtitle = new Label
            {
                Text = "本地 SSH 桥接 · 常驻托盘 · 关闭窗口后继续运行",
                ForeColor = Muted,
                AutoSize = true,
                Location = new Point(58, 32)
            };

            statusDot = new Label
            {
                Text = "●",
                ForeColor = Muted,
                AutoSize = true,
                Font = new Font("Segoe UI", 11f),
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };
            statusText = new Label
            {
                Text = "启动中…",
                ForeColor = Muted,
                AutoSize = true,
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };

            header.Controls.AddRange(new Control[] { logo, title, subtitle, statusDot, statusText });
            header.Resize += (s, e) =>
            {
                statusText.Location = new Point(header.Width - statusText.Width - 16, 20);
                statusDot.Location = new Point(statusText.Left - 16, 18);
            };

            // ---------- 连接信息 ----------
            var grid = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                Height = 108,
                ColumnCount = 3,
                BackColor = Panel,
                Padding = new Padding(12, 8, 12, 8)
            };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 44));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 86));
            for (int i = 0; i < 3; i++) grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));

            addressBox = MakeReadOnlyBox("—");
            tokenBox = MakeReadOnlyBox("—");
            portBox = new TextBox
            {
                Text = "8765",
                Width = 96,
                BackColor = Color.FromArgb(34, 34, 40),
                ForeColor = TextColor,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Consolas", 9f),
                Margin = new Padding(0, 3, 6, 3)
            };

            grid.Controls.Add(MakeLabel("地址"), 0, 0);
            grid.Controls.Add(addressBox, 1, 0);
            grid.Controls.Add(MakeButton("复制", () => { SetClipboard(addressBox.Text, "地址"); }), 2, 0);

            grid.Controls.Add(MakeLabel("令牌"), 0, 1);
            grid.Controls.Add(tokenBox, 1, 1);
            grid.Controls.Add(MakeButton("复制", () => { SetClipboard(tokenBox.Text, "令牌"); }), 2, 1);

            var portRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Margin = new Padding(0) };
            portRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 104));
            portRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            portRow.Controls.Add(portBox, 0, 0);
            var applyButton = MakeButton("应用并重启", ApplyPortFromText);
            applyButton.Width = 96;
            applyButton.Dock = DockStyle.Left;
            portRow.Controls.Add(applyButton, 1, 0);

            grid.Controls.Add(MakeLabel("端口"), 0, 2);
            grid.Controls.Add(portRow, 1, 2);
            grid.Controls.Add(MakeLabel(""), 2, 2);

            // ---------- 日志 ----------
            var logPanel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(12, 8, 12, 0) };
            logBox = new RichTextBox
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(16, 16, 18),
                ForeColor = Color.FromArgb(207, 207, 214),
                BorderStyle = BorderStyle.None,
                Font = new Font("Consolas", 9f),
                ReadOnly = true,
                WordWrap = false,
                ScrollBars = RichTextBoxScrollBars.Both,
                DetectUrls = false,
                HideSelection = false,
                TabStop = false
            };
            logPanel.Controls.Add(logBox);

            // ---------- 底部 ----------
            var bottom = new Panel { Dock = DockStyle.Bottom, Height = 52, BackColor = Bg };

            autoScroll = new CheckBox
            {
                Text = "自动滚动",
                Checked = true,
                ForeColor = Muted,
                AutoSize = true,
                Location = new Point(14, 18)
            };

            var restart = MakeButton("重启桥接", () => { owner.RestartBridge(); });
            var clear = MakeButton("清空日志", () => { logBox.Clear(); owner.ClearLog(); });
            var openDir = MakeButton("打开数据目录", () => { owner.OpenDataDir(); });
            var hide = MakeButton("隐藏到托盘", () => { Hide(); });
            var quit = MakeButton("退出", () => { owner.Quit(); });

            var buttons = new[] { restart, clear, openDir, hide, quit };
            int x = 0;
            for (int i = buttons.Length - 1; i >= 0; i--)
            {
                var b = buttons[i];
                b.AutoSize = false;
                b.Size = new Size(i >= 3 ? 88 : 92, 30);
                x -= b.Width + 8;
                b.Location = new Point(bottom.Width + x - 12, 12);
                b.Anchor = AnchorStyles.Top | AnchorStyles.Right;
                bottom.Controls.Add(b);
            }

            bottom.Controls.Add(autoScroll);
            bottom.Resize += (s, e) =>
            {
                int right = bottom.Width - 12;
                for (int i = buttons.Length - 1; i >= 0; i--)
                {
                    right -= buttons[i].Width;
                    buttons[i].Location = new Point(right, 12);
                    right -= 8;
                }
            };

            Controls.Add(logPanel);
            Controls.Add(bottom);
            Controls.Add(grid);
            Controls.Add(header);

            FormClosing += (s, e) =>
            {
                if (AllowClose) return;
                e.Cancel = true;
                if (MinimizeInsteadOfHide)
                {
                    WindowState = FormWindowState.Minimized;
                }
                else
                {
                    Hide();
                }
            };

            // 打开时不要给日志框焦点，避免出现光标占位
            Shown += (s, e) => { ActiveControl = null; };
        }

        private void ApplyPortFromText()
        {
            int port;
            if (!int.TryParse((portBox.Text ?? string.Empty).Trim(), out port) || port < 1 || port > 65535)
            {
                AppendLine(new LogEntry { Time = DateTime.Now, Level = "error", Text = "端口必须是 1-65535 之间的数字。" });
                return;
            }
            if (port == CurrentPort) return;
            CurrentPort = port;
            owner.ApplyPort(port);
        }

        /// <summary>优先用 PNG 资源绘制标题图标（透明背景更干净），失败时退回 exe 图标。</summary>
        private static Image LoadLogo(Icon fallback)
        {
            try
            {
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("icon.png"))
                {
                    if (stream != null)
                    {
                        using (var ms = new MemoryStream())
                        {
                            stream.CopyTo(ms);
                            ms.Position = 0;
                            return Image.FromStream(ms);
                        }
                    }
                }
            }
            catch (Exception) { /* fall through */ }
            return fallback.ToBitmap();
        }

        public void SetPort(int port)
        {
            if (port >= 1 && port <= 65535)
            {
                portBox.Text = port.ToString();
                CurrentPort = port;
            }
        }

        public void UpdateStatus(bool running, string address, string token)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action(() => UpdateStatus(running, address, token)));
                return;
            }

            statusDot.ForeColor = running ? Ok : ErrorColor;
            statusText.ForeColor = running ? Color.FromArgb(205, 238, 226) : Color.FromArgb(243, 195, 193);
            statusText.Text = running ? "运行中" : "未运行";
            statusText.Location = new Point(statusText.Parent.Width - statusText.Width - 16, 20);
            statusDot.Location = new Point(statusText.Left - 16, 18);

            if (!string.IsNullOrEmpty(address)) addressBox.Text = address;
            if (!string.IsNullOrEmpty(token)) tokenBox.Text = token;

            Text = "Meow SSH Bridge — 运行日志（" + (running ? "运行中" : "未运行") + "）";
        }

        public void LoadEntries(IEnumerable<LogEntry> entries)
        {
            logBox.Clear();
            foreach (LogEntry entry in entries) AppendLine(entry);
        }

        public void Append(LogEntry entry)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action(() => Append(entry)));
                return;
            }
            AppendLine(entry);
        }

        private void AppendLine(LogEntry entry)
        {
            Color color = TextColor;
            string level = entry.Level ?? "info";
            if (level == "success") color = Ok;
            else if (level == "warn") color = WarnColor;
            else if (level == "error") color = ErrorColor;

            string prefix = entry.Time.ToString("HH:mm:ss") + "  ";

            logBox.SelectionStart = logBox.TextLength;
            logBox.SelectionLength = 0;
            logBox.SelectionColor = Color.FromArgb(95, 95, 107);
            logBox.AppendText(prefix);
            logBox.SelectionColor = color;
            logBox.AppendText(entry.Text + Environment.NewLine);
            logBox.SelectionColor = logBox.ForeColor;

            if (autoScroll.Checked)
            {
                logBox.SelectionStart = logBox.TextLength;
                logBox.ScrollToCaret();
            }
        }

        private void SetClipboard(string text, string name)
        {
            if (string.IsNullOrEmpty(text) || text == "—") return;
            try
            {
                Clipboard.SetText(text);
                AppendLine(new LogEntry { Time = DateTime.Now, Level = "info", Text = "已复制" + name + "到剪贴板。" });
            }
            catch (Exception ex)
            {
                AppendLine(new LogEntry { Time = DateTime.Now, Level = "error", Text = "复制失败：" + ex.Message });
            }
        }

        private static Label MakeLabel(string text)
        {
            return new Label
            {
                Text = text,
                ForeColor = Muted,
                AutoSize = false,
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                Margin = new Padding(0, 0, 6, 0)
            };
        }

        private static TextBox MakeReadOnlyBox(string text)
        {
            return new TextBox
            {
                Text = text,
                ReadOnly = true,
                Dock = DockStyle.Fill,
                BorderStyle = BorderStyle.FixedSingle,
                BackColor = Color.FromArgb(34, 34, 40),
                ForeColor = Color.FromArgb(216, 243, 232),
                Font = new Font("Consolas", 9f),
                Margin = new Padding(0, 3, 6, 3)
            };
        }

        private static Button MakeButton(string text, Action onClick)
        {
            var button = new Button
            {
                Text = text,
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(42, 42, 49),
                ForeColor = Color.FromArgb(230, 230, 234),
                Size = new Size(80, 24),
                Margin = new Padding(0, 3, 0, 3),
                Cursor = Cursors.Hand,
                TabStop = false
            };
            button.FlatAppearance.BorderColor = Color.FromArgb(58, 58, 67);
            button.FlatAppearance.MouseOverBackColor = Color.FromArgb(52, 52, 64);
            button.Click += (s, e) => onClick();
            return button;
        }
    }
}
