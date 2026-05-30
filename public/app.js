const app = document.querySelector("#app");
const toastEl = document.querySelector("#toast");

const state = {
  token: localStorage.getItem("cmo_token") || "",
  data: null,
  view: "overview",
  filter: "",
  department: "all",
  eventSource: null,
  liveStatus: "متصل مباشر",
  theme: localStorage.getItem("cmo_theme") || "dark",
  pending2FA: null
};

document.documentElement.dataset.theme = state.theme;

const nav = [
  ["overview", "لوحة التحكم", "layout"],
  ["members", "الأعضاء", "users"],
  ["analytics", "التحليلات", "chart"],
  ["notifications", "التنبيهات", "bell"],
  ["calendar", "التقويم", "calendar"]
];

const iconPaths = {
  layout: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  spark: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7Z"/><path d="M19 17v4M17 19h4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>'
};

function icon(name) {
  return `<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.spark}</svg>`;
}

function roleLabel(role) {
  return { Admin: "مدير النظام", Publisher: "ناشر", Member: "عضو" }[role] || role;
}

function canManage() {
  return ["Admin", "Publisher"].includes(state.data?.user?.role);
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastEl.timer);
  toastEl.timer = setTimeout(() => toastEl.classList.remove("show"), 2800);
}

async function api(path, options = {}) {
  const headers = {
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok && response.status !== 206) {
    throw new Error(payload.error || "تعذر تنفيذ الطلب.");
  }
  return { response, payload };
}

async function bootstrap() {
  if (!state.token) {
    renderLogin();
    return;
  }
  try {
    await refreshState();
    connectRealtime();
  } catch {
    localStorage.removeItem("cmo_token");
    state.token = "";
    renderLogin();
  }
}

async function refreshState({ silent = false } = {}) {
  const { payload } = await api("/api/state");
  state.data = payload;
  if (!canManage() && state.view === "members") state.view = "overview";
  renderShell();
  if (!silent) requestAnimationFrame(drawCharts);
}

function connectRealtime() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource("/api/events");
  state.eventSource.addEventListener("state", async event => {
    const detail = JSON.parse(event.data || "{}");
    state.liveStatus = detail.reason === "connected" ? "متصل مباشر" : "تم تحديث البيانات";
    await refreshState({ silent: true });
    requestAnimationFrame(drawCharts);
    if (detail.reason !== "connected") toast("وصل تحديث مباشر إلى المنصة.");
  });
  state.eventSource.onerror = () => {
    state.liveStatus = "إعادة اتصال";
  };
}

function renderLogin() {
  app.className = "app";
  app.innerHTML = `
    <section class="login-shell">
      <div class="login-wrap">
        <div class="login-visual">
          <div class="brand-mark">${icon("shield")}</div>
          <div class="login-title">
            <p class="eyebrow">المكتب الإعلامي المركزي</p>
            <h1>منصة تقييم أداء فورية بمستوى أنظمة الشركات الحديثة</h1>
            <p>إدارة أعضاء، ترتيب شهري، تحليلات ذكية، وتنبيهات مباشرة تظهر لجميع المستخدمين فور اعتمادها من الإدارة.</p>
          </div>
          <div class="glass-strip">
            <div class="glass-chip"><strong>Live</strong><span>تزامن لحظي</span></div>
            <div class="glass-chip"><strong>3</strong><span>صلاحيات تشغيل</span></div>
            <div class="glass-chip"><strong>360</strong><span>رؤية أداء شاملة</span></div>
          </div>
        </div>
        <div class="login-card">
          <h2>تسجيل الدخول</h2>
          <p class="muted">اختر حسابًا تجريبيًا أو أدخل بياناتك للوصول إلى لوحة التحكم المناسبة لصلاحيتك.</p>
          <form class="form" id="loginForm">
            <div class="field">
              <label for="email">البريد الإلكتروني</label>
              <input id="email" name="email" type="email" autocomplete="email" required value="${state.pending2FA?.email || ""}" />
            </div>
            <div class="field">
              <label for="password">كلمة المرور</label>
              <input id="password" name="password" type="password" autocomplete="current-password" required value="${state.pending2FA?.password || ""}" />
            </div>
            <div class="field ${state.pending2FA ? "" : "hidden"}" id="twoFactorField">
              <label for="code">رمز التحقق الثنائي</label>
              <input id="code" name="code" inputmode="numeric" placeholder="123456" />
            </div>
            <button class="btn primary" type="submit">${icon("shield")} دخول آمن</button>
            <button class="btn" type="button" data-action="forgot">استعادة كلمة المرور</button>
          </form>
          <div class="demo-accounts">
            <button class="btn" data-demo="admin@media.local|Admin@2026">${icon("shield")} Admin <span>2FA</span></button>
            <button class="btn" data-demo="publisher@media.local|Publisher@2026">${icon("spark")} Publisher <span>تحكم كامل</span></button>
            <button class="btn" data-demo="member@media.local|Member@2026">${icon("users")} Member <span>لوحة شخصية</span></button>
          </div>
        </div>
      </div>
    </section>
  `;
  bindLogin();
}

function bindLogin() {
  document.querySelector("#loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const credentials = {
      email: form.get("email"),
      password: form.get("password"),
      code: form.get("code")
    };
    try {
      const { response, payload } = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials)
      });
      if (response.status === 206 || payload.twoFactorRequired) {
        state.pending2FA = credentials;
        renderLogin();
        toast(payload.message || "أدخل رمز التحقق.");
        return;
      }
      state.token = payload.token;
      state.pending2FA = null;
      localStorage.setItem("cmo_token", payload.token);
      await refreshState();
      connectRealtime();
      toast(`مرحبًا ${payload.user.name}`);
    } catch (error) {
      toast(error.message);
    }
  });

  document.querySelectorAll("[data-demo]").forEach(button => {
    button.addEventListener("click", () => {
      const [email, password] = button.dataset.demo.split("|");
      document.querySelector("#email").value = email;
      document.querySelector("#password").value = password;
      const code = document.querySelector("#code");
      if (email.startsWith("admin") && code) code.value = "123456";
    });
  });

  document.querySelector("[data-action='forgot']").addEventListener("click", async () => {
    const email = document.querySelector("#email").value || "unknown@media.local";
    await api("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
    toast("تم تسجيل طلب الاستعادة.");
  });
}

function renderShell() {
  app.className = "app shell";
  const user = state.data.user;
  const page = pageMeta();
  const visibleNav = nav.filter(item => canManage() || item[0] !== "members");
  app.innerHTML = `
    <aside class="sidebar">
      <div class="side-head">
        <div class="brand-mark">${icon("shield")}</div>
        <div>
          <strong>المكتب الإعلامي</strong>
          <span>Central Media Office</span>
        </div>
      </div>
      <nav class="nav" aria-label="التنقل الرئيسي">
        ${visibleNav.map(item => navButton(item, false)).join("")}
      </nav>
      <div class="sidebar-footer">
        <div class="panel">
          <strong class="user-name">${user.name}</strong>
          <span class="user-role">${roleLabel(user.role)}</span>
        </div>
        <button class="btn" data-action="logout">${icon("logout")} تسجيل الخروج</button>
      </div>
    </aside>
    <section class="content">
      <header class="topbar">
        <div class="page-title">
          <h2>${page.title}</h2>
          <p>${page.subtitle}</p>
        </div>
        <div class="top-actions">
          <span class="live-pill"><i class="pulse"></i>${state.liveStatus}</span>
          ${canManage() ? `<button class="btn" data-action="simulate" title="محاكاة تحديث مباشر">${icon("spark")} تحديث حي</button>` : ""}
          <button class="btn icon" data-action="theme" title="تبديل الوضع">${icon(state.theme === "dark" ? "sun" : "moon")}</button>
        </div>
      </header>
      ${renderView()}
    </section>
    <nav class="bottom-nav" aria-label="تنقل الهاتف">
      ${visibleNav.slice(0, 5).map(item => navButton(item, true)).join("")}
    </nav>
  `;
  bindShell();
}

function navButton([id, label, iconName], compact) {
  return `<button class="${state.view === id ? "active" : ""}" data-view="${id}" title="${label}">${icon(iconName)}${compact ? "" : `<span>${label}</span>`}</button>`;
}

function pageMeta() {
  const role = state.data?.user?.role;
  const labels = {
    overview: role === "Member" ? ["لوحتي الشخصية", "مؤشراتك الشهرية وترتيبك وتطور أدائك."] : ["لوحة التحكم", "نظرة تنفيذية على الأداء، الترتيب، والنشاط المباشر."],
    members: ["إدارة الأعضاء", "إضافة وتعديل الأعضاء والصلاحيات ومؤشرات التقييم."],
    analytics: ["التحليلات الذكية", "مقارنات الأداء والحضور والتفاعل والإنتاجية."],
    notifications: ["مركز التنبيهات", "إشعارات فورية وسجل نشاط لجميع التحديثات المهمة."],
    calendar: ["التقويم والاجتماعات", "جدولة الاجتماعات ومتابعة نسب الحضور."]
  };
  const [title, subtitle] = labels[state.view] || labels.overview;
  return { title, subtitle };
}

function renderView() {
  if (state.view === "members") return renderMembers();
  if (state.view === "analytics") return renderAnalytics();
  if (state.view === "notifications") return renderNotifications();
  if (state.view === "calendar") return renderCalendar();
  return renderOverview();
}

function renderOverview() {
  const { analytics: a, leaderboard, members } = state.data;
  const own = members[0];
  if (!canManage() && own) return renderMemberDashboard(own);
  const top = leaderboard.slice(0, 3);
  return `
    <div class="grid stats-grid">
      ${stat("إجمالي الأعضاء", a.totalMembers, "عضو نشط", "var(--primary)")}
      ${stat("متوسط التقييم", `${a.avgScore}%`, "تحسن شهري", "var(--amber)")}
      ${stat("التاسكات المنجزة", a.totalTasks, "هذا الشهر", "var(--blue)")}
      ${stat("الحضور العام", `${a.avgAttendance}%`, "اجتماعات", "var(--coral)")}
    </div>
    <div class="grid two-col" style="margin-top:16px">
      <section class="panel">
        <div class="panel-header">
          <div><h3>منحنى الأداء الشهري</h3><p>تحليل مباشر لدرجة المكتب عبر الأشهر الأخيرة.</p></div>
          <button class="btn small" data-action="export">${icon("download")} Excel</button>
        </div>
        <div class="chart-wrap"><canvas data-chart="line" data-values="${a.monthlyTrend.join(",")}"></canvas></div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div><h3>أفضل أعضاء الشهر</h3><p>مراكز Gold / Silver / Bronze حسب المعادلة الذكية.</p></div>
        </div>
        <div class="podium">
          ${top.map(renderPodiumCard).join("")}
        </div>
      </section>
    </div>
    <div class="grid two-col" style="margin-top:16px">
      <section class="panel">
        <div class="panel-header">
          <div><h3>الترتيب اللحظي</h3><p>أي تعديل من الإدارة ينعكس هنا فورًا.</p></div>
        </div>
        <div class="member-list">
          ${leaderboard.slice(0, 6).map(renderLeaderboardRow).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div><h3>النشاط الأخير</h3><p>سجل التحديثات الإدارية والنظامية.</p></div>
        </div>
        <div class="activity-list">${state.data.activity.slice(0, 7).map(renderActivity).join("")}</div>
      </section>
    </div>
  `;
}

function renderMemberDashboard(member) {
  return `
    <section class="panel">
      <div class="profile-hero">
        <img class="avatar xl" src="${member.avatar}" alt="${member.name}" />
        <div>
          <span class="rank-badge ${medalClass(member.medal)}">المركز ${member.rank} - ${medalArabic(member.medal)}</span>
          <h2 style="margin:12px 0 6px">${member.name}</h2>
          <p class="muted">${member.title}، ${member.department}</p>
          <div class="toolbar" style="justify-content:flex-start;margin:0">
            ${member.achievements.map(item => `<span class="tag">${item}</span>`).join("")}
          </div>
        </div>
        <div class="score-ring" style="--score:${member.score}"><strong>${member.score}%</strong></div>
      </div>
    </section>
    <div class="kpi-strip" style="margin-top:16px">
      ${metric("التاسكات", `${member.metrics.tasksDone}/${member.metrics.tasksTarget}`)}
      ${metric("الحضور", `${member.metrics.attendanceRate}%`)}
      ${metric("التفاعل", `${member.metrics.interaction}%`)}
      ${metric("الجودة", `${member.metrics.quality}%`)}
      ${metric("الالتزام", `${member.metrics.commitment}%`)}
    </div>
    <div class="grid two-col" style="margin-top:16px">
      <section class="panel">
        <div class="panel-header">
          <div><h3>تطور أدائك الشهري</h3><p>آخر ست نقاط تقييم شهرية.</p></div>
        </div>
        <div class="chart-wrap"><canvas data-chart="line" data-values="${member.trend.join(",")}"></canvas></div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div><h3>نشاطك الأسبوعي</h3><p>توزيع الإنجاز خلال أيام الأسبوع.</p></div>
        </div>
        <div class="chart-wrap"><canvas data-chart="bar" data-values="${member.weekly.join(",")}"></canvas></div>
      </section>
    </div>
    <div class="grid two-col" style="margin-top:16px">
      <section class="panel">
        <div class="panel-header">
          <div><h3>ترتيب الشهر</h3><p>عرض مختصر للمراكز الحالية.</p></div>
        </div>
        <div class="member-list">${state.data.leaderboard.slice(0, 5).map(renderLeaderboardRow).join("")}</div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div><h3>تنبيهاتك</h3><p>آخر إشعارات الإدارة والإنجازات.</p></div>
        </div>
        <div class="notification-list">${state.data.notifications.slice(0, 5).map(renderNotification).join("")}</div>
      </section>
    </div>
  `;
}

function renderMembers() {
  const departments = ["all", ...new Set(state.data.members.map(member => member.department))];
  const members = filteredMembers();
  return `
    <section class="panel">
      <div class="toolbar">
        <div class="group">
          <input class="searchbox" data-filter="search" value="${state.filter}" placeholder="بحث عن عضو أو قسم..." />
          <select class="searchbox" data-filter="department">
            ${departments.map(dep => `<option value="${dep}" ${state.department === dep ? "selected" : ""}>${dep === "all" ? "كل الأقسام" : dep}</option>`).join("")}
          </select>
        </div>
        <div class="group">
          <button class="btn primary" data-action="add-member">${icon("plus")} إضافة عضو</button>
          <button class="btn" data-action="export">${icon("download")} تصدير CSV</button>
        </div>
      </div>
      <div class="table-shell">
        <table class="data-table">
          <thead>
            <tr>
              <th>العضو</th>
              <th>القسم</th>
              <th>التقييم</th>
              <th>الحضور</th>
              <th>التفاعل</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            ${members.map(renderMemberTr).join("") || `<tr><td colspan="7"><div class="empty-state">لا توجد نتائج مطابقة.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAnalytics() {
  const a = state.data.analytics;
  const heat = Array.from({ length: 56 }, (_, index) => (index * 17 + a.avgScore + a.totalTasks) % 100);
  return `
    <div class="grid stats-grid">
      ${stat("جودة التنفيذ", `${a.avgQuality}%`, "متوسط المكتب", "var(--primary)")}
      ${stat("نسبة التفاعل", `${a.avgInteraction}%`, "تعليقات ومساهمات", "var(--violet)")}
      ${stat("الحضور", `${a.avgAttendance}%`, "اجتماعات الشهر", "var(--amber)")}
      ${stat("الأعضاء المتصلون", a.onlineMembers, "Online الآن", "var(--green)")}
    </div>
    <div class="grid two-col" style="margin-top:16px">
      <section class="panel">
        <div class="panel-header">
          <div><h3>الإنتاجية الأسبوعية</h3><p>مؤشر النشاط عبر أيام الأسبوع.</p></div>
        </div>
        <div class="chart-wrap"><canvas data-chart="bar" data-values="${a.weeklyActivity.join(",")}"></canvas></div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div><h3>مقارنة الأقسام</h3><p>أداء وحمل عمل كل قسم.</p></div>
        </div>
        <div class="department-grid">
          ${a.departments.map(dep => `
            <div class="department-row">
              <strong>${dep.department}</strong>
              <div>
                <div class="progress" title="الأداء"><i style="--value:${dep.score}%"></i></div>
                <div class="progress" style="margin-top:7px" title="حمل العمل"><i style="--value:${dep.load}%;background:linear-gradient(90deg,var(--coral),var(--violet))"></i></div>
              </div>
              <span class="tag">${dep.score}%</span>
            </div>
          `).join("")}
        </div>
      </section>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header">
        <div><h3>Heatmap النشاط</h3><p>كثافة التفاعل والإنتاج على مستوى الأسابيع.</p></div>
      </div>
      <div class="heatmap">
        ${heat.map(value => `<span class="heat-cell ${value > 42 ? "hot" : ""}" style="--heat:${value / 100}" title="${value}%"></span>`).join("")}
      </div>
    </section>
  `;
}

function renderNotifications() {
  return `
    <div class="grid two-col">
      <section class="panel">
        <div class="panel-header">
          <div><h3>مركز الإشعارات</h3><p>تنبيهات التقييم والترتيب والاجتماعات.</p></div>
        </div>
        <div class="notification-list">
          ${state.data.notifications.map(renderNotification).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div><h3>إرسال تنبيه</h3><p>متاح للإدارة والناشر.</p></div>
        </div>
        ${canManage() ? `
          <form class="form" id="notifyForm">
            <div class="field">
              <label>العنوان</label>
              <input name="title" required placeholder="مثال: تحديث تقييم الشهر" />
            </div>
            <div class="field">
              <label>النص</label>
              <textarea name="body" rows="4" required placeholder="اكتب التنبيه..."></textarea>
            </div>
            <button class="btn primary" type="submit">${icon("bell")} إرسال فوري</button>
          </form>
        ` : `<div class="empty-state">تظهر هنا تنبيهات الإدارة والتحديثات الجديدة.</div>`}
      </section>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="panel-header">
        <div><h3>Activity Logs</h3><p>سجل تدقيق مختصر للتغييرات الأخيرة.</p></div>
      </div>
      <div class="activity-list">${state.data.activity.map(renderActivity).join("")}</div>
    </section>
  `;
}

function renderCalendar() {
  return `
    <div class="grid two-col">
      <section class="panel">
        <div class="panel-header">
          <div><h3>الاجتماعات القادمة</h3><p>جدولة ومتابعة نسب حضور الفريق.</p></div>
        </div>
        <div class="meeting-list">
          ${state.data.meetings.map(meeting => `
            <div class="meeting-row">
              <strong>${meeting.title}</strong>
              <span>${meeting.date}، ${meeting.time}</span>
              <div class="progress" style="margin-top:12px"><i style="--value:${meeting.attendance}%"></i></div>
            </div>
          `).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div><h3>تحليل الحضور</h3><p>مؤشر حضور الاجتماعات الشهرية.</p></div>
        </div>
        <div class="chart-wrap"><canvas data-chart="bar" data-values="${state.data.meetings.map(item => item.attendance).join(",")}"></canvas></div>
      </section>
    </div>
  `;
}

function stat(label, value, hint, accent) {
  return `
    <div class="stat-card" style="--accent:${accent}">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${hint}</small>
    </div>
  `;
}

function metric(label, value) {
  return `<div class="metric-tile"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderPodiumCard(member) {
  return `
    <div class="podium-card ${medalClass(member.medal)}">
      <span class="rank-badge ${medalClass(member.medal)}">${medalArabic(member.medal)}</span>
      <img class="avatar large" src="${member.avatar}" alt="${member.name}" />
      <strong>${member.name}</strong>
      <span class="muted">${member.title}</span>
      <strong>${member.score}%</strong>
    </div>
  `;
}

function renderLeaderboardRow(member) {
  return `
    <div class="member-row">
      <img class="avatar" src="${member.avatar}" alt="${member.name}" />
      <div class="member-info">
        <strong>${member.name}</strong>
        <span>${member.title || ""}</span>
      </div>
      <span class="rank-badge ${medalClass(member.medal)} hide-mobile">#${member.rank}</span>
      <div class="hide-mobile"><div class="progress"><i style="--value:${member.score}%"></i></div></div>
      <strong>${member.score}%</strong>
    </div>
  `;
}

function renderMemberTr(member) {
  return `
    <tr>
      <td>
        <div class="member-row" style="display:flex;padding:0;border:0;background:none">
          <img class="avatar" src="${member.avatar}" alt="${member.name}" />
          <div class="member-info"><strong>${member.name}</strong><span>${member.title}</span></div>
        </div>
      </td>
      <td>${member.department}</td>
      <td><span class="rank-badge ${medalClass(member.medal)}">#${member.rank} - ${member.score}%</span></td>
      <td>${member.metrics.attendanceRate}%</td>
      <td>${member.metrics.interaction}%</td>
      <td><span class="status ${statusClass(member.status)}">${statusArabic(member.status)}</span></td>
      <td>
        <div class="row-actions">
          <button class="btn icon small" title="تعديل" data-action="edit-member" data-id="${member.id}">${icon("edit")}</button>
          ${state.data.user.role === "Admin" ? `<button class="btn icon small danger" title="حذف" data-action="delete-member" data-id="${member.id}">${icon("trash")}</button>` : ""}
        </div>
      </td>
    </tr>
  `;
}

function renderNotification(note) {
  return `
    <div class="notification-row">
      <strong>${note.title}</strong>
      <span>${note.body}</span>
    </div>
  `;
}

function renderActivity(item) {
  return `
    <div class="activity-row">
      <strong>${item.actor}</strong>
      <span>${item.action}</span>
    </div>
  `;
}

function medalClass(medal) {
  return String(medal || "").toLowerCase();
}

function medalArabic(medal) {
  return { Gold: "Gold", Silver: "Silver", Bronze: "Bronze", Standard: "Standard" }[medal] || "Standard";
}

function statusClass(status) {
  return String(status || "").toLowerCase();
}

function statusArabic(status) {
  return { Online: "متصل", Busy: "مشغول", Offline: "غير متصل" }[status] || status;
}

function filteredMembers() {
  const query = state.filter.trim().toLowerCase();
  return state.data.members.filter(member => {
    const matchesQuery = !query || `${member.name} ${member.title} ${member.department}`.toLowerCase().includes(query);
    const matchesDepartment = state.department === "all" || member.department === state.department;
    return matchesQuery && matchesDepartment;
  });
}

function bindShell() {
  document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      renderShell();
      requestAnimationFrame(drawCharts);
    });
  });

  document.querySelectorAll("[data-action='theme']").forEach(button => {
    button.addEventListener("click", () => {
      state.theme = state.theme === "dark" ? "light" : "dark";
      localStorage.setItem("cmo_theme", state.theme);
      document.documentElement.dataset.theme = state.theme;
      renderShell();
      requestAnimationFrame(drawCharts);
    });
  });

  document.querySelectorAll("[data-action='logout']").forEach(button => {
    button.addEventListener("click", logout);
  });

  document.querySelectorAll("[data-action='simulate']").forEach(button => {
    button.addEventListener("click", async () => {
      await api("/api/simulate", { method: "POST", body: "{}" });
      toast("تم إرسال تحديث حي.");
    });
  });

  document.querySelectorAll("[data-action='export']").forEach(button => {
    button.addEventListener("click", () => {
      window.location.href = "/api/export/members.csv";
    });
  });

  document.querySelectorAll("[data-action='add-member']").forEach(button => {
    button.addEventListener("click", () => openMemberModal());
  });

  document.querySelectorAll("[data-action='edit-member']").forEach(button => {
    button.addEventListener("click", () => openMemberModal(button.dataset.id));
  });

  document.querySelectorAll("[data-action='delete-member']").forEach(button => {
    button.addEventListener("click", async () => {
      const member = state.data.members.find(item => item.id === button.dataset.id);
      if (!member || !confirm(`حذف ${member.name} من النظام؟`)) return;
      await api(`/api/members/${member.id}`, { method: "DELETE" });
      toast("تم حذف العضو.");
    });
  });

  document.querySelectorAll("[data-filter='search']").forEach(input => {
    input.addEventListener("input", event => {
      state.filter = event.target.value;
      renderShell();
    });
  });

  document.querySelectorAll("[data-filter='department']").forEach(select => {
    select.addEventListener("change", event => {
      state.department = event.target.value;
      renderShell();
    });
  });

  const notifyForm = document.querySelector("#notifyForm");
  if (notifyForm) {
    notifyForm.addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      await api("/api/notifications", {
        method: "POST",
        body: JSON.stringify({ title: form.get("title"), body: form.get("body"), audience: "all" })
      });
      event.currentTarget.reset();
      toast("تم إرسال التنبيه.");
    });
  }

  drawCharts();
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* Session may already be gone. */
  }
  localStorage.removeItem("cmo_token");
  state.token = "";
  state.data = null;
  if (state.eventSource) state.eventSource.close();
  renderLogin();
}

function openMemberModal(memberId) {
  const member = memberId ? state.data.members.find(item => item.id === memberId) : null;
  const isEdit = Boolean(member);
  document.querySelector(".modal")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-card">
        <div class="modal-head">
          <div>
            <h3 style="margin:0">${isEdit ? "تعديل عضو" : "إضافة عضو"}</h3>
            <p class="muted" style="margin:6px 0 0">${isEdit ? "حدّث المؤشرات وسيظهر التغيير فورًا." : "سيتم إنشاء حساب عضو بكلمة مرور افتراضية."}</p>
          </div>
          <button class="btn icon" data-modal-close title="إغلاق">${icon("x")}</button>
        </div>
        <form class="form" id="memberForm">
          <div class="form-grid">
            ${field("name", "الاسم", member?.name || "", true)}
            ${field("email", "البريد", member ? "" : "", !isEdit, isEdit ? "hidden" : "email")}
            ${field("title", "المسمى", member?.title || "", true)}
            ${field("department", "القسم", member?.department || "", true)}
            ${field("avatar", "رابط الصورة", member?.avatar || "", false)}
            <div class="field">
              <label>الحالة</label>
              <select name="status">
                ${["Online", "Busy", "Offline"].map(status => `<option value="${status}" ${member?.status === status ? "selected" : ""}>${statusArabic(status)}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="panel" style="box-shadow:none;margin-top:8px">
            <div class="panel-header"><h3>مؤشرات التقييم</h3></div>
            ${range("tasksDone", "التاسكات", member?.metrics.tasksDone || 20, 0, 60)}
            ${range("quality", "الجودة", member?.metrics.quality || 80)}
            ${range("deliverySpeed", "السرعة", member?.metrics.deliverySpeed || 80)}
            ${range("commitment", "الالتزام", member?.metrics.commitment || 80)}
            ${range("attendanceRate", "الحضور", member?.metrics.attendanceRate || 80)}
            ${range("interaction", "التفاعل", member?.metrics.interaction || 80)}
            ${range("contributions", "المساهمات", member?.metrics.contributions || 20, 0, 60)}
          </div>
          <div class="toolbar" style="margin:0">
            <button class="btn primary" type="submit">${icon("save")} حفظ</button>
            <button class="btn" type="button" data-modal-close>إلغاء</button>
          </div>
        </form>
      </div>
    </div>
    `
  );
  document.querySelectorAll("[data-modal-close]").forEach(button => button.addEventListener("click", () => document.querySelector(".modal")?.remove()));
  document.querySelectorAll(".range-row input").forEach(input => {
    input.addEventListener("input", () => {
      input.closest(".range-row").querySelector("strong").textContent = input.value;
    });
  });
  document.querySelector("#memberForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const metrics = {};
    ["tasksDone", "quality", "deliverySpeed", "commitment", "attendanceRate", "interaction", "contributions"].forEach(key => {
      metrics[key] = Number(form.get(key));
    });
    const payload = {
      name: form.get("name"),
      email: form.get("email"),
      title: form.get("title"),
      department: form.get("department"),
      avatar: form.get("avatar"),
      status: form.get("status"),
      metrics
    };
    const endpoint = isEdit ? `/api/members/${member.id}` : "/api/members";
    const method = isEdit ? "PATCH" : "POST";
    const { payload: result } = await api(endpoint, { method, body: JSON.stringify(payload) });
    document.querySelector(".modal")?.remove();
    toast(isEdit ? "تم تحديث العضو." : `تم إنشاء العضو. كلمة المرور: ${result.password}`);
  });
}

function field(name, label, value, required, type = "text") {
  if (type === "hidden") return "";
  return `
    <div class="field">
      <label>${label}</label>
      <input name="${name}" type="${type}" value="${escapeAttr(value)}" ${required ? "required" : ""} />
    </div>
  `;
}

function range(name, label, value, min = 0, max = 100) {
  return `
    <label class="range-row">
      <span>${label}</span>
      <input name="${name}" type="range" min="${min}" max="${max}" value="${value}" />
      <strong>${value}</strong>
    </label>
  `;
}

function escapeAttr(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function drawCharts() {
  document.querySelectorAll("canvas[data-chart]").forEach(canvas => {
    const values = canvas.dataset.values.split(",").map(Number);
    const type = canvas.dataset.chart;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const styles = getComputedStyle(document.documentElement);
    const text = styles.getPropertyValue("--muted").trim();
    const primary = styles.getPropertyValue("--primary").trim();
    const amber = styles.getPropertyValue("--amber").trim();
    const line = styles.getPropertyValue("--line").trim();
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const y = 20 + ((rect.height - 40) / 3) * i;
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(rect.width - 10, y);
      ctx.stroke();
    }
    if (type === "bar") drawBar(ctx, values, rect, primary, amber);
    else drawLine(ctx, values, rect, primary, amber);
    ctx.fillStyle = text;
    ctx.font = "12px Segoe UI";
    ctx.fillText("0", rect.width - 18, rect.height - 12);
    ctx.fillText("100", rect.width - 34, 18);
  });
}

function drawLine(ctx, values, rect, primary, amber) {
  const max = Math.max(100, ...values);
  const min = Math.min(0, ...values);
  const width = rect.width - 36;
  const height = rect.height - 48;
  const points = values.map((value, index) => {
    const x = 18 + (width / Math.max(values.length - 1, 1)) * index;
    const y = 24 + height - ((value - min) / (max - min || 1)) * height;
    return [x, y];
  });
  const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
  gradient.addColorStop(0, primary);
  gradient.addColorStop(1, amber);
  ctx.beginPath();
  points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.lineTo(points.at(-1)[0], rect.height - 24);
  ctx.lineTo(points[0][0], rect.height - 24);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, 20, 0, rect.height);
  fill.addColorStop(0, "rgba(142,230,211,.22)");
  fill.addColorStop(1, "rgba(142,230,211,0)");
  ctx.fillStyle = fill;
  ctx.fill();
  points.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = primary;
    ctx.fill();
  });
}

function drawBar(ctx, values, rect, primary, amber) {
  const max = Math.max(100, ...values);
  const gap = 10;
  const width = (rect.width - 36 - gap * (values.length - 1)) / values.length;
  const base = rect.height - 24;
  values.forEach((value, index) => {
    const height = ((rect.height - 48) * value) / max;
    const x = 18 + index * (width + gap);
    const y = base - height;
    const gradient = ctx.createLinearGradient(0, y, 0, base);
    gradient.addColorStop(0, primary);
    gradient.addColorStop(1, amber);
    roundRect(ctx, x, y, width, height, 8);
    ctx.fillStyle = gradient;
    ctx.fill();
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

window.addEventListener("resize", () => requestAnimationFrame(drawCharts));

bootstrap();
