# نشر المنصة وإرسالها للأعضاء

`localhost` يعمل على جهازك فقط. لكي ترسل المنصة للأعضاء تحتاج رابط عام مثل:

```text
https://media-office.example.com
```

## الخيار الأسرع: Render أو Railway أو VPS

ارفع هذا المجلد كاملًا إلى GitHub أو إلى الخادم، ثم اضبط:

```text
Build command: لا يوجد
Start command: node server.js
PORT: يحدده مزود الاستضافة أو 4173
NODE_ENV: production
JWT_SECRET: قيمة طويلة وسرية
DATA_DIR: مسار تخزين دائم مثل /app/data
```

مهم جدًا: إذا كان مزود الاستضافة يعيد تشغيل الحاويات بدون تخزين دائم، اربط Volume دائم على `DATA_DIR` حتى لا تضيع بيانات الأعضاء.

## Docker

```bash
docker build -t central-media-office .
docker run -d \
  --name central-media-office \
  -p 4173:4173 \
  -e NODE_ENV=production \
  -e JWT_SECRET="change-this-to-a-very-long-secret" \
  -e DATA_DIR=/app/data \
  -v cmo-data:/app/data \
  central-media-office
```

ثم افتح:

```text
http://SERVER-IP:4173
```

وللرابط الرسمي استخدم دومين مع HTTPS عبر Nginx أو Cloudflare.

## الحسابات الأولية

- Admin: `admin@media.local` / `Admin@2026`، رمز 2FA: `123456`
- Publisher: `publisher@media.local` / `Publisher@2026`
- Member: `member@media.local` / `Member@2026`

بعد أول دخول، أنشئ حسابًا لكل عضو من لوحة `إدارة الأعضاء`، ثم أرسل لكل عضو:

- رابط المنصة العام
- البريد الخاص به
- كلمة المرور التي تظهر عند إنشاء الحساب

## فحص التشغيل

```text
/api/health
```

إذا أعاد:

```json
{"ok":true}
```

فالخدمة تعمل.
