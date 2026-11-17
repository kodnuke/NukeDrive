# NukeDrive — Kurulum ve İnternete Açma Rehberi

Bilgisayarınızda çalışan, web sitesi + Android uygulaması olarak kullanılan kişisel drive.

```
[Telefon APK] ─┐
               ├──HTTPS──> Cloudflare ──tünel──> bilgisayarınız: Node sunucu (127.0.0.1:4000)
[Tarayıcı]   ──┘                                   ├─ /api/*   → dosya/oturum API
                                                   ├─ /*       → web arayüzü
                                                   └─ apps/server/data/ (SQLite + dosyalar)
```

Tek port (4000) hem API'yi hem web sitesini sunar. Modem'de port açmanız gerekmez; Cloudflare Tunnel ücretsiz HTTPS sağlar ve ev IP'nizi gizler.

---

## 0. En kolay yol: Her şeyi arayüzden kurun (Windows kurulum dosyası)

`apps\desktop\release\NukeDrive Setup 0.1.0.exe` dosyasını çalıştırıp kurun. Node.js, komut satırı veya elle düzenlenecek bir dosya gerekmez.

İlk açılışta **Kurulum ve Ayarlar** penceresi gelir. Sonradan da sistem tepsisindeki NukeDrive simgesine sağ tıklayıp **Kurulum ve ayarlar** ile açabilirsiniz. Pencerede sırasıyla:

1. **Durum ve hesap** — *Drive'ı aç* → *Hesap oluştur*. İlk kaydolan kişi sahibidir; sonra kayıt kendiliğinden kapanır.
2. **İnternete açma** — üç seçenek:
   - *Kapalı*: sadece bu bilgisayar.
   - *Hızlı tünel*: hesap gerekmez, tek tıkla `https://…trycloudflare.com` adresi alırsınız. Adres uygulama her açıldığında değişir; denemek içindir.
   - *Kalıcı adres* (önerilen): pencerede yazan adımlarla Cloudflare panelinde bir tünel oluşturup token'ı yapıştırırsınız (ör. `https://drive.alanadiniz.com`). Gerekli `cloudflared` programını uygulama Cloudflare'in resmi sürümünden kendisi indirir ve uygulama açık olduğu sürece tüneli çalıştırır. Token Windows hesabınıza bağlı olarak şifrelenip saklanır.
3. **Android uygulaması** — pencerede görünen `…/NukeDrive.apk` adresini telefonun tarayıcısında açıp kurun. Uygulama ilk açılışta **sunucu adresini** sorar; internet adresinizi girip giriş yapın. (Telefon uygulaması HTTPS ister; önce 2. adımı tamamlayın.) Web sitesindeki giriş sayfasında da *Android uygulamasını indir* linki bulunur.
4. **Sunucu ayarları** — kimlerin erişebileceği (sadece bu bilgisayar / yerel ağ), yeni hesaba izin, port, en büyük dosya boyutu. *Kaydet* deyince uygulama kendini yeniden başlatır.
5. **Başlangıç ve yedekleme** — *Windows açılışında başlat* (tepside sessizce başlar) ve *Şimdi yedek al…* (veritabanının tutarlı kopyası + tüm dosyalar seçtiğiniz klasöre).

Bilmeniz gerekenler:

- Pencereyi kapatınca uygulama **sistem tepsisine** iner; sunucu ve tünel çalışmaya devam eder. Tamamen durdurmak için tepside **Çıkış**'ı seçin.
- Veriler `%APPDATA%\NukeDrive\data`, ayarlar `%APPDATA%\NukeDrive\config.json` içinde durur.
- Eski verileri taşımak için uygulamadan çıkın, `apps\server\data\` içeriğini `%APPDATA%\NukeDrive\data\` içine kopyalayın ve uygulamayı yeniden açın.
- Kurulum dosyası imzalı değil. Windows SmartScreen "Tanınmayan uygulama" uyarısı verirse *Ek bilgi → Yine de çalıştır* deyin.
- Kurulum dosyasını (APK dahil) yeniden üretmek için geliştirici makinesinde: `npm run build:desktop` (Android SDK ve JDK 17 gerekir, bkz. 6. adım).

Bu yolu kullanıyorsanız aşağıdaki 1–6. adımlara ihtiyacınız yok; 7. adım (güvenlik) yine geçerlidir. Aşağıdakiler uygulamayı kurmadan, komut satırıyla çalıştırmak isteyenler içindir.

---

## 1. Gereksinimler

| Ne | Neden |
|---|---|
| Node.js 22.5+ (önerilen 24) | Sunucu (yerleşik `node:sqlite` kullanır) |
| Bir alan adı (Cloudflare'de yönetilen) | İnternetten HTTPS erişim |
| Android Studio + JDK 17 | APK derlemek için (Android Studio > Settings > Gradle JDK > Download JDK 17) |

## 2. İlk kurulum

```bash
npm install
```

Sunucu ayar dosyasını oluşturun:

```bash
copy apps\server\.env.example apps\server\.env
```

Güçlü bir gizli anahtar üretin ve `apps/server/.env` içindeki `JWT_SECRET=` satırına yapıştırın:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> `NODE_ENV=production` iken `JWT_SECRET` 32 karakterden kısaysa sunucu **başlamaz**. Bu bilinçli bir korumadır.

## 3. Derle ve çalıştır

```bash
npm run build:server
```

```bash
npm run build:web
```

```bash
npm start --workspace apps/server
```

Tarayıcıda http://localhost:4000 açın → **ilk kayıt olan kullanıcı** hesabınızdır. Sonrasında kayıt otomatik kapanır (bkz. Güvenlik).

Test:

```bash
npm test --workspace apps/server
```

## 4. Bilgisayar açılınca otomatik başlatma (Windows)

```bash
npm install -g pm2 pm2-windows-startup
```

```bash
pm2 start apps/server/dist/index.js --name nukedrive --cwd apps/server
```

```bash
pm2-startup install
```

```bash
pm2 save
```

> `--cwd apps/server` önemli: veriler çalışma klasöründeki `data/` altına yazılır.

## 5. İnternete açma — Cloudflare Tunnel (önerilen)

1. Alan adınızı Cloudflare'e ekleyin (ücretsiz plan yeterli).
2. cloudflared'i kurun:
   ```bash
   winget install --id Cloudflare.cloudflared
   ```
3. Giriş yapın ve tünel oluşturun:
   ```bash
   cloudflared tunnel login
   ```
   ```bash
   cloudflared tunnel create nukedrive
   ```
   ```bash
   cloudflared tunnel route dns nukedrive drive.alanadiniz.com
   ```
4. `C:\Users\<kullanıcı>\.cloudflared\config.yml` dosyasını oluşturun:
   ```yaml
   tunnel: nukedrive
   credentials-file: C:\Users\<kullanıcı>\.cloudflared\<TÜNEL-ID>.json
   ingress:
     - hostname: drive.alanadiniz.com
       service: http://127.0.0.1:4000
     - service: http_status:404
   ```
5. Windows hizmeti olarak kurun (her açılışta çalışır):
   ```bash
   cloudflared service install
   ```

Artık https://drive.alanadiniz.com üzerinden erişebilirsiniz.

> **Yükleme boyutu:** Cloudflare ücretsiz plan istek başına **100 MB** ile sınırlar. Daha büyük dosyalar için Tailscale (aşağıda) veya kendi ters vekiliniz gerekir.

### Alternatif: Sadece kendi cihazlarınız için — Tailscale

Siteyi herkese açmak istemiyorsanız: bilgisayara ve telefona Tailscale kurun, `tailscale serve --bg 4000` ile cihazlarınıza özel HTTPS adresi alırsınız. Dışarıdan kimse göremez; en güvenli seçenek budur. Bu durumda `.env` içinde `HOST=127.0.0.1` kalabilir.

### Alternatif: Port yönlendirme (önerilmez)

Modemde 443'ü açıp Caddy ile otomatik HTTPS kullanabilirsiniz. Ev IP'niz açığa çıkar ve DDoS/tarama riskini siz taşırsınız.

## 6. Android APK

```bash
npm run build:apk
```

Çıktı: proje kökünde `NukeDrive.apk`. Telefona kopyalayıp kurun ("bilinmeyen kaynaklar" izni gerekir).

- Script, `%USERPROFILE%\.jdks` altındaki JDK 17'yi ve `%LOCALAPPDATA%\Android\Sdk` yolunu otomatik kullanır.
- Uygulama sunucu adresini ilk girişte sorar; adres değişirse yeniden derlemeye gerek yok. Adresi APK'ya gömmek isterseniz: `powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1 -ServerUrl https://drive.alanadiniz.com`
- Bu bir **debug** APK'dır. Play Store veya uzun süreli kullanım için Android Studio → *Build → Generate Signed App Bundle/APK* ile kendi anahtarınızla imzalayın; anahtarı kaybetmeyin.

## 7. Güvenlik — ne yapıldı, siz ne yapmalısınız

**Sistemde hazır olanlar**

| Koruma | Detay |
|---|---|
| Şifreler | bcrypt ile hash'lenir, düz metin saklanmaz |
| Oturum | JWT, varsayılan 7 gün geçerli (`JWT_EXPIRES`); süresi dolunca otomatik çıkış |
| Kayıt kontrolü | Sadece ilk kullanıcı kayıt olabilir; diğerleri için `ALLOW_REGISTER=true` |
| Brute-force | Giriş/kayıt: IP başına dakikada 10 deneme; genel API: dakikada 300 istek |
| Yetki | Her dosya sorgusu sahibine göre filtrelenir; başkasının dosyasına erişilemez |
| Girdi doğrulama | E-posta formatı, şifre 8–128 karakter, dosya adlarında yol/kontrol karakteri temizliği |
| Klasör döngüsü | Klasör kendi alt klasörüne taşınamaz |
| Yükleme | Diske akış ile yazılır (RAM'e alınmaz), `MAX_UPLOAD_MB` sınırı |
| Paylaşım linkleri | 192-bit rastgele token, isteğe bağlı son kullanma tarihi |
| HTTP başlıkları | `nosniff`, `X-Frame-Options: DENY`, `no-referrer`; dosyalar `attachment` olarak iner (tarayıcıda çalıştırılamaz) |
| Ağ | `HOST=127.0.0.1` ile sunucu yalnızca tünelden erişilebilir |

**Sizin yapmanız gerekenler**

1. `JWT_SECRET`'ı üretin ve kimseyle paylaşmayın. Değiştirirseniz tüm oturumlar kapanır (çalınan token şüphesinde bunu yapın).
2. Güçlü, benzersiz bir şifre kullanın.
3. `apps/server/data/` klasörünü düzenli yedekleyin (başka diske/buluta). Disk arızasında tek kopya budur.
4. Windows ve Node.js'i güncel tutun; ara sıra `npm audit` çalıştırın.
5. Cloudflare panelinde ek koruma isterseniz: *Zero Trust → Access* ile siteyi sadece kendi e-postanıza açabilirsiniz (APK'da da tarayıcı girişi gerektirir; paylaşım linklerini `/shared/*` ve `/api/shared/*` yolları için hariç tutun).
6. Dosyalar diskte şifrelenmemiş durur. Bilgisayar çalınma riskine karşı Windows BitLocker'ı açın.

**Bilinen sınırlar**

- İndirme linkinde oturum token'ı URL'de taşınır (`?token=`); tarayıcı geçmişinde görünebilir. Paylaşılan bilgisayarda kullandıktan sonra çıkış yapın.
- İki adımlı doğrulama (2FA) ve şifre sıfırlama e-postası yoktur. Şifrenizi unutursanız `data/nukedrive.db` içinden kullanıcıyı silip yeniden kaydolmanız gerekir (dosyalar o kullanıcıyla birlikte silinir).
- Kullanıcı başına kota yoktur; kayıt açarsanız diskinizi doldurabilirler.

## 8. Geliştirme modu

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Web: http://localhost:5173 (API isteklerini 4000'e yönlendirir).

## 9. Sorun giderme

| Belirti | Çözüm |
|---|---|
| Sunucu "JWT_SECRET en az 32 karakter" diye kapanıyor | 2. adımdaki komutla anahtar üretin |
| "Kayıt kapalı" | Normal; hesabınız zaten var. Yeni kullanıcı için `ALLOW_REGISTER=true` + yeniden başlat |
| "Çok fazla istek" (429) | 1 dakika bekleyin |
| APK açılıyor ama giriş "Network error" | APK derlerken verilen adres yanlış veya sunucu/tünel kapalı; adresi telefon tarayıcısında deneyin |
| Büyük dosya yüklenmiyor | Cloudflare 100 MB sınırı veya `MAX_UPLOAD_MB` |
