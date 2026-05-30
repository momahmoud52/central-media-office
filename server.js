import http from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const storePath = path.join(dataDir, "store.json");
const port = Number(process.env.PORT || 4173);
const isProduction = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET || (isProduction ? "" : "dev-central-media-office-secret-change-me");
const sseClients = new Set();

if (isProduction && !jwtSecret) {
  console.error("JWT_SECRET is required when NODE_ENV=production.");
  process.exit(1);
}

const roles = {
  ADMIN: "Admin",
  PUBLISHER: "Publisher",
  MEMBER: "Member"
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function forbidden(res) {
  json(res, 403, { error: "ليست لديك صلاحية لتنفيذ هذا الإجراء." });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signToken(payload) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 12 }));
  const signature = crypto.createHmac("sha256", jwtSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function readToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)cmo_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = crypto.createHmac("sha256", jwtSecret).update(`${header}.${body}`).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (payload.exp < Date.now()) return null;
  return payload;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function memberScore(metrics) {
  const taskScore = Math.min(metrics.tasksDone / Math.max(metrics.tasksTarget, 1), 1) * 24;
  const qualityScore = metrics.quality * 0.18;
  const speedScore = metrics.deliverySpeed * 0.12;
  const commitmentScore = metrics.commitment * 0.12;
  const attendanceScore = metrics.attendanceRate * 0.14;
  const interactionScore = metrics.interaction * 0.12;
  const contributionScore = Math.min(metrics.contributions / 40, 1) * 8;
  return Math.round(taskScore + qualityScore + speedScore + commitmentScore + attendanceScore + interactionScore + contributionScore);
}

function rankedMembers(store) {
  return [...store.members]
    .map(member => ({
      ...member,
      score: memberScore(member.metrics)
    }))
    .sort((a, b) => b.score - a.score)
    .map((member, index) => ({
      ...member,
      rank: index + 1,
      medal: index === 0 ? "Gold" : index === 1 ? "Silver" : index === 2 ? "Bronze" : "Standard"
    }));
}

function scopedState(store, user) {
  const ranked = rankedMembers(store);
  const ownMember = ranked.find(member => member.userId === user.id);
  const canManage = [roles.ADMIN, roles.PUBLISHER].includes(user.role);
  return {
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      email: user.email,
      memberId: user.memberId || null,
      twoFactorEnabled: Boolean(user.twoFactorEnabled)
    },
    members: canManage ? ranked : ownMember ? [ownMember] : [],
    leaderboard: canManage
      ? ranked
      : ranked.map(({ id, name, title, avatar, score, rank, medal, achievements, status }) => ({
          id,
          name,
          title,
          avatar,
          score,
          rank,
          medal,
          achievements,
          status
        })),
    analytics: analytics(store, ranked),
    notifications: store.notifications.filter(note => canManage || !note.audience || note.audience === "all" || note.memberId === ownMember?.id).slice(0, 24),
    activity: store.activity.slice(0, 40),
    meetings: store.meetings
  };
}

function analytics(store, ranked = rankedMembers(store)) {
  const totals = ranked.reduce(
    (acc, member) => {
      acc.tasks += member.metrics.tasksDone;
      acc.attendance += member.metrics.attendanceRate;
      acc.interaction += member.metrics.interaction;
      acc.quality += member.metrics.quality;
      acc.score += member.score;
      return acc;
    },
    { tasks: 0, attendance: 0, interaction: 0, quality: 0, score: 0 }
  );
  const count = Math.max(ranked.length, 1);
  return {
    totalMembers: ranked.length,
    onlineMembers: ranked.filter(member => member.status === "Online").length,
    avgAttendance: Math.round(totals.attendance / count),
    avgInteraction: Math.round(totals.interaction / count),
    avgQuality: Math.round(totals.quality / count),
    avgScore: Math.round(totals.score / count),
    totalTasks: totals.tasks,
    departments: ["الإنتاج", "النشر", "التصميم", "الرصد"].map((department, index) => ({
      department,
      score: Math.round(76 + ((index * 9 + totals.score) % 20)),
      load: Math.round(58 + ((index * 11 + totals.tasks) % 34))
    })),
    weeklyActivity: [68, 74, 81, 77, 92, 86, 73],
    monthlyTrend: [72, 75, 78, 79, 83, 86, Math.round(totals.score / count)]
  };
}

function publicMember(member) {
  return {
    id: member.id,
    userId: member.userId,
    name: member.name,
    title: member.title,
    department: member.department,
    role: member.role,
    avatar: member.avatar,
    status: member.status,
    achievements: member.achievements,
    metrics: member.metrics,
    trend: member.trend,
    weekly: member.weekly,
    joinedAt: member.joinedAt,
    lastActive: member.lastActive
  };
}

function makeUser({ id, name, email, role, password, memberId, twoFactorEnabled = false }) {
  const hashed = hashPassword(password);
  return {
    id,
    name,
    email,
    role,
    salt: hashed.salt,
    passwordHash: hashed.hash,
    memberId,
    twoFactorEnabled
  };
}

async function ensureStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    await stat(storePath);
  } catch {
    const users = [
      makeUser({ id: "u-admin", name: "مدير النظام", email: "admin@media.local", role: roles.ADMIN, password: "Admin@2026", twoFactorEnabled: true }),
      makeUser({ id: "u-pub", name: "مسؤول النشر", email: "publisher@media.local", role: roles.PUBLISHER, password: "Publisher@2026" }),
      makeUser({ id: "u-m1", name: "ليان منصور", email: "member@media.local", role: roles.MEMBER, password: "Member@2026", memberId: "m1" }),
      makeUser({ id: "u-m2", name: "آدم الراشد", email: "adam@media.local", role: roles.MEMBER, password: "Member@2026", memberId: "m2" }),
      makeUser({ id: "u-m3", name: "سارة العلي", email: "sara@media.local", role: roles.MEMBER, password: "Member@2026", memberId: "m3" }),
      makeUser({ id: "u-m4", name: "نور الحربي", email: "nour@media.local", role: roles.MEMBER, password: "Member@2026", memberId: "m4" }),
      makeUser({ id: "u-m5", name: "مازن جابر", email: "mazen@media.local", role: roles.MEMBER, password: "Member@2026", memberId: "m5" }),
      makeUser({ id: "u-m6", name: "ريم فهد", email: "reem@media.local", role: roles.MEMBER, password: "Member@2026", memberId: "m6" })
    ];
    const members = [
      member("m1", "u-m1", "ليان منصور", "قائدة محتوى", "الإنتاج", "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=320&q=80", "Online", [38, 93, 88, 91, 94, 86, 34], ["صانعة الشهر", "التزام عال"]),
      member("m2", "u-m2", "آدم الراشد", "منتج فيديو", "الإنتاج", "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=320&q=80", "Online", [34, 89, 91, 85, 88, 82, 29], ["سرعة إنجاز"]),
      member("m3", "u-m3", "سارة العلي", "مصممة رقمية", "التصميم", "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=320&q=80", "Busy", [31, 95, 84, 88, 83, 91, 31], ["جودة ذهبية"]),
      member("m4", "u-m4", "نور الحربي", "راصدة إعلامية", "الرصد", "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=320&q=80", "Offline", [29, 84, 80, 86, 89, 76, 25], ["حضور ثابت"]),
      member("m5", "u-m5", "مازن جابر", "منسق نشر", "النشر", "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=320&q=80", "Online", [42, 87, 92, 80, 81, 78, 22], ["نشر سريع"]),
      member("m6", "u-m6", "ريم فهد", "محللة أداء", "التحليلات", "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=320&q=80", "Online", [28, 91, 86, 93, 92, 89, 36], ["تحليل متقدم", "تفاعل نشط"])
    ];
    await writeFile(
      storePath,
      JSON.stringify(
        {
          users,
          members,
          notifications: [
            note("تم تحديث ترتيب الشهر", "تم اعتماد نقاط الأداء للأسبوع الأخير وتحديث لوحة الترتيب.", "all", "rank"),
            note("اجتماع فريق الإنتاج", "الاجتماع القادم يوم الثلاثاء الساعة 10:30 صباحًا.", "all", "calendar"),
            note("شارة جديدة", "تم منح شارة الالتزام العالي للعضو الأعلى حضورًا.", "all", "badge")
          ],
          activity: [
            activity("مدير النظام", "حدّث معايير التقييم الشهري"),
            activity("مسؤول النشر", "أضاف مهمة نشر عاجلة"),
            activity("ليان منصور", "أكملت 5 مهام بجودة عالية")
          ],
          meetings: [
            { id: "meet-1", title: "اجتماع التخطيط الأسبوعي", date: "2026-06-02", time: "10:30", attendance: 92 },
            { id: "meet-2", title: "مراجعة الحملة الرقمية", date: "2026-06-05", time: "13:00", attendance: 87 },
            { id: "meet-3", title: "ورشة تحسين المحتوى", date: "2026-06-09", time: "11:15", attendance: 94 }
          ]
        },
        null,
        2
      )
    );
  }
}

function member(id, userId, name, title, department, avatar, status, seed, achievements) {
  const [tasksDone, quality, deliverySpeed, commitment, attendanceRate, interaction, contributions] = seed;
  return {
    id,
    userId,
    name,
    title,
    department,
    role: roles.MEMBER,
    avatar,
    status,
    achievements,
    joinedAt: "2025-09-01",
    lastActive: new Date(Date.now() - Math.random() * 1000 * 60 * 50).toISOString(),
    metrics: {
      tasksDone,
      tasksTarget: 42,
      quality,
      deliverySpeed,
      commitment,
      attendanceRate,
      meetingsAttended: Math.round(attendanceRate / 10),
      lateCount: Math.max(0, Math.round((100 - commitment) / 12)),
      absentCount: Math.max(0, Math.round((100 - attendanceRate) / 20)),
      interaction,
      dailyActivity: Math.round((interaction + commitment) / 2),
      comments: Math.round(contributions * 1.7),
      contributions
    },
    trend: [68, 71, 76, 79, 83, Math.round((quality + attendanceRate + interaction) / 3)],
    weekly: [4, 7, 6, 8, 9, 5, 3]
  };
}

function note(title, body, audience = "all", type = "info", memberId = null) {
  return {
    id: crypto.randomUUID(),
    title,
    body,
    audience,
    type,
    memberId,
    createdAt: new Date().toISOString(),
    read: false
  };
}

function activity(actor, action) {
  return {
    id: crypto.randomUUID(),
    actor,
    action,
    createdAt: new Date().toISOString()
  };
}

async function loadStore() {
  await ensureStore();
  return JSON.parse(await readFile(storePath, "utf8"));
}

async function saveStore(store) {
  await writeFile(storePath, JSON.stringify(store, null, 2));
}

function broadcast(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) client.write(message);
}

function canManage(user) {
  return [roles.ADMIN, roles.PUBLISHER].includes(user.role);
}

async function currentUser(req, store) {
  const payload = verifyToken(readToken(req));
  if (!payload) return null;
  return store.users.find(user => user.id === payload.sub) || null;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(publicDir, safePath === "/" ? "index.html" : safePath);
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: "Forbidden" });
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mime[path.extname(filePath)] || "application/octet-stream",
      "cache-control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=3600"
    });
    res.end(data);
  } catch {
    const data = await readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(data);
  }
}

async function handleApi(req, res) {
  const store = await loadStore();
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await parseBody(req);
    const user = store.users.find(candidate => candidate.email.toLowerCase() === String(body.email || "").toLowerCase());
    if (!user || !verifyPassword(String(body.password || ""), user)) return json(res, 401, { error: "بيانات الدخول غير صحيحة." });
    if (user.twoFactorEnabled && body.code !== "123456") return json(res, 206, { twoFactorRequired: true, message: "أدخل رمز التحقق التجريبي 123456." });
    const token = signToken({ sub: user.id, role: user.role, name: user.name });
    const secureCookie = isProduction || req.headers["x-forwarded-proto"] === "https";
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": `cmo_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secureCookie ? "; Secure" : ""}`
    });
    res.end(JSON.stringify({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email } }));
    return;
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": "cmo_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/api/auth/forgot-password" && req.method === "POST") {
    const body = await parseBody(req);
    store.activity.unshift(activity("النظام", `تم إنشاء طلب استعادة كلمة مرور لـ ${body.email || "حساب غير محدد"}`));
    await saveStore(store);
    broadcast("state", { reason: "password-reset-request" });
    return json(res, 200, { ok: true, message: "تم تسجيل طلب الاستعادة. في الإنتاج يرسل النظام رابطًا آمنًا للبريد." });
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    const user = await currentUser(req, store);
    if (!user) return json(res, 401, { error: "Unauthorized" });
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });
    res.write(`event: state\ndata: ${JSON.stringify({ reason: "connected" })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  const user = await currentUser(req, store);
  if (!user) return json(res, 401, { error: "Unauthorized" });

  if (url.pathname === "/api/session" && req.method === "GET") {
    return json(res, 200, { user: { id: user.id, name: user.name, role: user.role, email: user.email } });
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    return json(res, 200, scopedState(store, user));
  }

  if (url.pathname === "/api/members" && req.method === "POST") {
    if (!canManage(user)) return forbidden(res);
    const body = await parseBody(req);
    const id = crypto.randomUUID();
    const userId = `u-${id.slice(0, 8)}`;
    const password = body.password || "Member@2026";
    const newUser = makeUser({
      id: userId,
      name: body.name,
      email: body.email,
      role: body.role || roles.MEMBER,
      password,
      memberId: id
    });
    const newMember = publicMember({
      id,
      userId,
      name: body.name || "عضو جديد",
      title: body.title || "عضو المكتب الإعلامي",
      department: body.department || "النشر",
      role: body.role || roles.MEMBER,
      avatar: body.avatar || "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=320&q=80",
      status: "Online",
      achievements: ["عضو جديد"],
      joinedAt: new Date().toISOString().slice(0, 10),
      lastActive: new Date().toISOString(),
      metrics: {
        tasksDone: Number(body.tasksDone || 0),
        tasksTarget: 42,
        quality: Number(body.quality || 75),
        deliverySpeed: Number(body.deliverySpeed || 75),
        commitment: Number(body.commitment || 75),
        attendanceRate: Number(body.attendanceRate || 75),
        meetingsAttended: 0,
        lateCount: 0,
        absentCount: 0,
        interaction: Number(body.interaction || 70),
        dailyActivity: 70,
        comments: 0,
        contributions: Number(body.contributions || 0)
      },
      trend: [55, 58, 61, 65, 70, 75],
      weekly: [2, 3, 2, 4, 5, 3, 1]
    });
    store.users.push(newUser);
    store.members.push(newMember);
    store.activity.unshift(activity(user.name, `أضاف العضو ${newMember.name}`));
    store.notifications.unshift(note("عضو جديد", `تم إضافة ${newMember.name} إلى لوحة الأداء.`, "all", "member"));
    await saveStore(store);
    broadcast("state", { reason: "member-created", memberId: id });
    return json(res, 201, { member: newMember, password });
  }

  const memberMatch = url.pathname.match(/^\/api\/members\/([^/]+)$/);
  if (memberMatch && req.method === "PATCH") {
    if (!canManage(user)) return forbidden(res);
    const body = await parseBody(req);
    const member = store.members.find(item => item.id === memberMatch[1]);
    if (!member) return json(res, 404, { error: "لم يتم العثور على العضو." });
    const editable = ["name", "title", "department", "avatar", "status", "achievements"];
    for (const key of editable) {
      if (body[key] !== undefined) member[key] = body[key];
    }
    if (body.metrics) {
      for (const [key, value] of Object.entries(body.metrics)) {
        if (typeof member.metrics[key] === "number") member.metrics[key] = Number(value);
      }
      member.trend = [...member.trend.slice(-5), memberScore(member.metrics)];
    }
    member.lastActive = new Date().toISOString();
    store.activity.unshift(activity(user.name, `حدّث بيانات ${member.name}`));
    store.notifications.unshift(note("تحديث تقييم", `تم تحديث تقييم ${member.name} وترتيبه الشهري.`, "all", "rank", member.id));
    await saveStore(store);
    broadcast("state", { reason: "member-updated", memberId: member.id });
    return json(res, 200, { member });
  }

  if (memberMatch && req.method === "DELETE") {
    if (user.role !== roles.ADMIN) return forbidden(res);
    const member = store.members.find(item => item.id === memberMatch[1]);
    if (!member) return json(res, 404, { error: "لم يتم العثور على العضو." });
    store.members = store.members.filter(item => item.id !== member.id);
    store.users = store.users.filter(item => item.id !== member.userId);
    store.activity.unshift(activity(user.name, `حذف العضو ${member.name}`));
    store.notifications.unshift(note("تم حذف عضو", `تم حذف ${member.name} من النظام.`, "all", "member"));
    await saveStore(store);
    broadcast("state", { reason: "member-deleted", memberId: member.id });
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/notifications" && req.method === "POST") {
    if (!canManage(user)) return forbidden(res);
    const body = await parseBody(req);
    const created = note(body.title || "تنبيه جديد", body.body || "تحديث جديد من الإدارة.", body.audience || "all", body.type || "info", body.memberId || null);
    store.notifications.unshift(created);
    store.activity.unshift(activity(user.name, `أرسل تنبيهًا: ${created.title}`));
    await saveStore(store);
    broadcast("state", { reason: "notification-created" });
    return json(res, 201, { notification: created });
  }

  if (url.pathname === "/api/simulate" && req.method === "POST") {
    if (!canManage(user)) return forbidden(res);
    const index = Math.floor(Math.random() * store.members.length);
    const member = store.members[index];
    const keys = ["tasksDone", "quality", "deliverySpeed", "commitment", "attendanceRate", "interaction", "contributions"];
    const key = keys[Math.floor(Math.random() * keys.length)];
    const current = member.metrics[key];
    member.metrics[key] = key === "tasksDone" || key === "contributions" ? Math.min(current + 1, 60) : Math.min(current + Math.ceil(Math.random() * 4), 100);
    member.trend = [...member.trend.slice(-5), memberScore(member.metrics)];
    member.lastActive = new Date().toISOString();
    store.activity.unshift(activity("التحديث اللحظي", `تغير مؤشر ${key} لدى ${member.name}`));
    await saveStore(store);
    broadcast("state", { reason: "live-simulation", memberId: member.id });
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/export/members.csv" && req.method === "GET") {
    if (!canManage(user)) return forbidden(res);
    const rows = rankedMembers(store).map(member => [
      member.rank,
      member.name,
      member.department,
      member.score,
      member.metrics.tasksDone,
      member.metrics.attendanceRate,
      member.metrics.interaction
    ]);
    const csv = [["rank", "name", "department", "score", "tasks", "attendance", "interaction"], ...rows]
      .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=central-media-members.csv"
    });
    res.end(csv);
    return;
  }

  json(res, 404, { error: "API endpoint not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/health") return json(res, 200, { ok: true, service: "central-media-office", time: new Date().toISOString() });
    if (req.url.startsWith("/api/")) return await handleApi(req, res);
    return await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "حدث خطأ غير متوقع في الخادم." });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Central Media Office platform running on http://localhost:${port}`);
});
