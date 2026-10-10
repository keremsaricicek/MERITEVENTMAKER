# Model okumasını çalıştırma — adım adım

Bu belge, plan okuması için görüntü-dil modelini (VLM) **kendi API
anahtarınızla** ilk kez çalıştırmanın yolunu anlatır. Anahtar yalnız
sunucunun ortam değişkeninde `ANTHROPIC_API_KEY` olarak durur: sohbete,
GitHub deposuna, tarayıcı koduna ya da kayıtlara girmez.

> Bakiye yüklenmeden **Planı modele gönder** demeyin: istek `NO_BALANCE`
> ("API hesabında bakiye yok") ile geri döner ve ücret çıkmaz. **Bağlantıyı
> sına (ücretsiz)** düğmesi bakiye olmadan da denenebilir; anahtarın ve
> modelin kabul edildiğini söyler, bakiyeyi denetlemez.

## Yol A — GitHub Codespaces (önerilen; bilgisayarınıza hiçbir şey kurmazsınız)

1. **Gizli ayar:** github.com → sağ üstte profil resminiz → **Settings** →
   sol menüde **Codespaces** → **Secrets** bölümünde **New secret**.
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** API anahtarınız
   - **Repository access:** `keremsaricicek/MERITEVENTMAKER` seçin → **Add secret**.
2. Depo sayfasında dalı seçin (`claude/merit-concept3-plan-intelligence-rebirth`,
   birleştirildikten sonra `main`) → yeşil **Code** düğmesi → **Codespaces**
   sekmesi → **Create codespace on …**.
3. Açılan sayfanın altındaki terminale sırayla yazın:
   ```
   npm ci
   npm run serve:vlm
   ```
   Çıktıda `relay       CONFIGURED` yazmalı. `NOT CONFIGURED (ANTHROPIC_API_KEY
   is not set …)` yazıyorsa gizli ayar bu codespace'e ulaşmamıştır: 1. adımda
   depo erişimini kontrol edip codespace'i yeniden başlatın.
4. Sağ altta çıkan **Open in Browser** düğmesine basın (ya da **PORTS**
   sekmesinde 8787 satırındaki küre simgesi). Bağlantı noktasını **Private**
   bırakın.
5. Uygulamada: etkinlik oluşturun → planı içe aktarın → **Kat Planı**'nda
   tespiti çalıştırın → üstteki **İnceleme** → sağ üstte **Model okuması**.
6. Panelde **MODEL AKTARICISI HAZIR** görünmeli. **Bağlantıyı sına
   (ücretsiz)** → "Anahtar ve model kabul edildi" yazmalı.
7. Bakiye yüklendikten sonra: **Planı modele gönder** → açılan pencerede
   neyin gönderileceğini ve harcama sınırlarını okuyun → **Gönder**.
8. Bulgular planın üzerinde kesikli çerçeveler ve soldaki listede satırlar
   olarak gelir. Her birini tek tek **Kabul et**, **Reddet** ya da **Göster**
   ile karara bağlayın. Kabul etmediğiniz hiçbir şey planı değiştirmez.
   **Model okumasını iptal et** süren isteği anında durdurur.

## Yol B — Kendi bilgisayarınız

Node.js 20 veya üstü gerekir (geliştirici aracıdır; son kullanıcı ürünü için
kurulum istenmez).

```
git clone https://github.com/keremsaricicek/MERITEVENTMAKER.git
cd MERITEVENTMAKER
git checkout claude/merit-concept3-plan-intelligence-rebirth
npm ci
```

Anahtarı yalnız o terminal oturumunda ortam değişkeni yapın (dosyaya yazmayın):

- PowerShell 7: `$env:ANTHROPIC_API_KEY = Read-Host -MaskInput "Anahtar"` sonra `npm run serve:vlm`
- Windows PowerShell 5.1: `$s = Read-Host "Anahtar" -AsSecureString; $env:ANTHROPIC_API_KEY = [Net.NetworkCredential]::new("", $s).Password` sonra `npm run serve:vlm`
- macOS/Linux: `read -s ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY && npm run serve:vlm`

Tarayıcıda `http://127.0.0.1:8787/index.html` açın ve Yol A'nın 5–8.
adımlarını izleyin.

## Pilot — ilk gerçek ölçüm (açık onayınızla)

Ücretli istek ve gerçek plan aktarımı **yalnız sizin açık onayınızla** yapılır.
Onay şu üç şeyden sonra istenir: gizli ayar (yukarıda Yol A, 1. adım; tek
seferlik), API hesabında bakiye ve aşağıdaki içerik ile bütçe.

**Gönderilecek planlar:** iki gerçek mekân: Golden Plan
(`benchmarks/plans/merit-real-venue-plan.png`, 1355×788) ve ORNEK
(`benchmarks/plans/ornek-upright.png`, 2402×1719). Her biri için bir okuma
yapılır. **Gönderilenler:** plan görüntüsü, dedektörün kutuları (tür, inceleme
durumu, doğrulanmış numara) ve plandan okunan yazılar. **Gönderilmeyenler:**
misafir, not, davet eden, oturma düzeni, etkinlik adı. Plan üzerinde BASILI bir
isim veya numara varsa görüntüyle birlikte gider; bu iki planda yalnız masa
numaraları, ölçüler ve "SAHNE/BAR/GİRİŞ" gibi yazılar vardır.

**Bütçe (en kötü durum, resmi fiyatlar, 2026-10-10):** varsayılan model
`claude-opus-5-5` için milyon belirteç başına $4 girdi ve $20 çıktı. Bu iki planda
bir denemenin girdisi tahminen ~20 000 belirtece kadardır (görüntü ≤ ~4 800 +
kutular ve yazılar). Aktarıcı, göndermeden önce gerçek sayıyı ücretsiz
`count_tokens` ile ölçer ve sınır denetimini o sayıyla yapar. Çıktı en çok
10 000 belirteçtir. Bir deneme bu durumda ≈ $0,08 + $0,20 = **≈ $0,28** eder. Bir okuma en çok 5 denemedir
(genel görünüm + 4 yakın bakış) ve okuma başına sınır $1,50'dir. İki plan için
en kötü durum **≤ $2,80**. Pilot için aktarıcıyı şu sınırla başlatın:

```
VLM_MAX_USD_PER_DAY=3 VLM_MAX_USD_PER_RUN=1.50 npm run serve:vlm
```

Aktarıcı, bir denemeyi göndermeden önce en kötü maliyetini ayırır ve bu
sınırları aşacak isteği reddeder. Gerçek harcama genellikle bunun çok
altındadır: çıktı nadiren 10 000 belirtece ulaşır.

**Ölçülecekler:** her plan için bulgu sayısı, kabul ve ret sayısı, yanlış öneri
(planda olmayan nesne), bulunan gerçek eksik, harcanan tutar ve süre. Bunlar,
modelsiz ölçümle (`benchmarks/BASELINE.json`) ayrı satırlarda raporlanır. Sahte
modelle (`tests/lib/fake-anthropic.mjs`) alınan sonuçlar bu tabloya hiçbir
zaman girmez.

## Sınırlar (varsayılan)

| | |
|---|---|
| Model | `claude-opus-5-5` (`VLM_MODEL` ile değişir) |
| Okuma başına | en çok $1.50 (`VLM_MAX_USD_PER_RUN`) |
| Günlük | en çok $5.00 (`VLM_MAX_USD_PER_DAY`), 40 istek (`VLM_MAX_REQUESTS_PER_DAY`) |
| Okuma başına adım | 5: tüm plan + en çok 4 yakın bakış (`VLM_MAX_STEPS_PER_RUN`) |
| İstek süresi | 180 sn (`VLM_TIMEOUT_MS`) |

Aktarıcı her isteği **en kötü durum** maliyetiyle (izin verilen tüm çıktı
belirteçleri, modelle yedek model arasındaki pahalı fiyattan) önceden ayırır;
sınırı aşabilecek istek hiç gönderilmez. Günlük kayıt `.vlm-data/usage.json`
dosyasındadır ve yalnız toplamları tutar.

## Testler neyi kanıtlar, neyi kanıtlamaz

`vlm-relay` ve `vlm-reading` test takımları gerçek aktarıcıyı ve gerçek
ekranı, cevapları **önceden yazılmış** sahte bir sunucuya karşı çalıştırır.
Anahtar güvenliğini, sınırları, iptali, hata adlarını ve eski analize gelen
cevabın reddini kanıtlar; **modelin planı ne kadar iyi okuduğu hakkında
hiçbir şey kanıtlamaz.** İlk gerçek ölçüm, bakiyeli anahtarla yapılacak ilk
okumadır.
