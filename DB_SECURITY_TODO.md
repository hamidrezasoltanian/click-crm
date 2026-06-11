# امنیت PostgreSQL — اقدامات باقی‌مانده

## ۱. یوزر اختصاصی DB بساز (مهم‌ترین)

الان اپ با یوزر `postgres` (superuser) وصل می‌شه. باید یوزر محدود بسازی:

```sql
-- در psql اجرا کن
CREATE USER atena_app WITH PASSWORD 'یک-رمز-قوی-بنویس';
GRANT CONNECT ON DATABASE atena_crm TO atena_app;
GRANT USAGE ON SCHEMA public TO atena_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO atena_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO atena_app;
```

بعد در `.env`:
```
PG_USER=atena_app
PG_PASSWORD=همان-رمز-بالا
```

---

## ۲. JWT_SECRET قوی بساز

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

خروجی رو در `.env` بنویس:
```
JWT_SECRET=خروجی-دستور-بالا
```

سرور رو restart کن.

---

## ۳. PostgreSQL فقط localhost گوش بده

در فایل `postgresql.conf`:
```
listen_addresses = 'localhost'
```

بعد PostgreSQL رو restart کن:
```bash
sudo systemctl restart postgresql
```

---

## ۴. بک‌آپ خودکار روزانه

```bash
# این cron job رو اضافه کن (crontab -e)
0 2 * * * pg_dump atena_crm | gzip > /backup/atena_$(date +%Y%m%d).sql.gz

# پوشه بک‌آپ بساز
mkdir -p /backup
```

برای restore:
```bash
gunzip -c /backup/atena_20260611.sql.gz | psql atena_crm
```

---

## ۵. ANTHROPIC_API_KEY از env var بخونه (نه DB)

در `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

این کار باعث می‌شه key هرگز به client فرستاده نشه.

---

## چک‌لیست

- [ ] یوزر اختصاصی DB ساخته شد
- [ ] JWT_SECRET قوی تنظیم شد و سرور restart شد
- [ ] `listen_addresses = 'localhost'` در postgresql.conf
- [ ] cron job بک‌آپ روزانه فعال شد
- [ ] ANTHROPIC_API_KEY در .env تنظیم شد
