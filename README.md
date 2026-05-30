# منصة تقييم أعضاء المكتب الإعلامي المركزي

تطبيق محلي كامل قابل للتشغيل فورًا، مبني بدون اعتماد على حزم خارجية حتى يعمل في هذه المساحة مباشرة. يحتوي على:

- تسجيل دخول بأدوار `Admin` و`Publisher` و`Member`.
- JWT موقّع بـ HMAC وجلسة Cookie آمنة محليًا.
- REST API لإدارة الأعضاء والتنبيهات والتصدير.
- تحديثات مباشرة باستخدام Server-Sent Events.
- لوحة Admin/Publisher لإدارة الأعضاء والنتائج.
- لوحة Member تعرض بيانات العضو وترتيبه فقط مع ترتيب عام مختصر.
- واجهة عربية RTL متجاوبة مع Bottom Navigation للهواتف.
- ثيم ليلي/نهاري، بحث، فلترة، رسوم بيانية Canvas، Heatmap، نشاط، تقويم، وتنبيهات.

## التشغيل

```powershell
node server.js
```

ثم افتح:

```text
http://localhost:4173
```

## حسابات تجريبية

- Admin: `admin@media.local` / `Admin@2026`، رمز 2FA التجريبي: `123456`
- Publisher: `publisher@media.local` / `Publisher@2026`
- Member: `member@media.local` / `Member@2026`

## ملاحظات إنتاجية

هذه النسخة تعمل كمنتج أولي محلي عالي الجودة. للانتقال إلى Production كامل يوصى بنقل الواجهة إلى Next.js/TypeScript وربط الخادم بـ PostgreSQL أو Supabase/Firebase Auth، واستبدال مخزن JSON المحلي بقاعدة بيانات وتخزين ملفات آمن.
