# Ezan Vakti — GNOME Shell eklentisi

GNOME üst çubuğunda bir sonraki ezan vaktini ve kalan süreyi gösterir.
Vakitler **Diyanet İşleri Başkanlığı**'nın kendi sitesinden (namazvakitleri.diyanet.gov.tr) alınır.

![Panel görünümü](docs/panel.png)

## Özellikler

- Üst çubukta konum, sıradaki vakit ve kalan süre
- Tıklayınca günün tüm vakitleri, miladi ve hicri tarih
- Ezandan önce bildirim (süre ayarlanabilir, varsayılan 10 dk)
- Kerahat vaktinden önce ikindi hatırlatması (varsayılan: akşamdan 45 dk önce kerahat, 10 dk önce bildirim)
- Ayarlar penceresinden ülke / il / ilçe seçimi (Diyanet'in desteklediği tüm konumlar)
- Vakitler yıl sonuna kadar indirilip saklanır; internet yokken de çalışır
- Diyanet sitesine ulaşılamazsa yedek kaynak: ezanvakti.emushaf.net

Desteklenen sürümler: GNOME Shell 45 – 50. Test edilen: GNOME Shell 50 (Ubuntu, Wayland).

## Kurulum

### 1. Hazır paketle (önerilen)

1. [Releases](https://github.com/makbulut/ezan-vakti-gnome/releases/latest) sayfasından
   `ezan-vakti@mehmetakbulut.com.tr.shell-extension.zip` dosyasını indir.
2. Kur:

   ```bash
   gnome-extensions install --force ~/İndirilenler/ezan-vakti@mehmetakbulut.com.tr.shell-extension.zip
   ```

   (Dosyayı nereye indirdiysen o yolu yaz; İngilizce sistemlerde `~/Downloads`.)
3. **Oturumu kapatıp tekrar aç.** Wayland'de GNOME yeni eklentileri ancak yeniden girişte görür.
4. Etkinleştir:

   ```bash
   gnome-extensions enable ezan-vakti@mehmetakbulut.com.tr
   ```

   veya **Eklentiler** (Extensions) uygulamasından "Ezan Vakti"yi aç.

### 2. Kaynaktan

```bash
git clone https://github.com/makbulut/ezan-vakti-gnome.git
cd ezan-vakti-gnome
tools/install.sh
```

Ardından yukarıdaki 3. ve 4. adımlar (oturumu kapat/aç, etkinleştir).

## Ayarlar

Panel'deki ezan vaktine tıkla → **Ayarlar**, veya:

```bash
gnome-extensions prefs ezan-vakti@mehmetakbulut.com.tr
```

| Ayar | Açıklama |
|---|---|
| Ülke / İl / İlçe | Vakitlerin alınacağı konum (varsayılan: İstanbul) |
| Konum adını göster | Paneldeki konum adını gizler/gösterir |
| Ezan bildirimi | Açık/kapalı, kaç dakika önce, Güneş vakti dahil mi |
| Kerahat hatırlatması | Açık/kapalı, kerahatin akşamdan kaç dk önce başladığı, kaç dk önce bildirileceği |

## Güncelleme

Yeni sürümü aynı şekilde `gnome-extensions install --force ...zip` ile kur, sonra oturumu kapatıp aç.

## Kaldırma

```bash
gnome-extensions uninstall ezan-vakti@mehmetakbulut.com.tr
rm -rf ~/.cache/ezan-vakti                                        # indirilen vakitler
dconf reset -f /org/gnome/shell/extensions/ezan-vakti/            # ayarlar
```

## Sorun giderme

Eklentinin kayıtları:

```bash
journalctl -b /usr/bin/gnome-shell | grep -i ezan
```

Normalde `[ezan-vakti] N gün alındı (diyanet)` satırı görünür. Panelde "Vakitler yükleniyor" kalıyorsa
internet bağlantısını kontrol edip menüden **Vakitleri yenile**'ye bas.

## Geliştirme

| Dosya | Görev |
|---|---|
| `ezan-vakti@mehmetakbulut.com.tr/extension.js` | Panel göstergesi, vakit çekme/ayrıştırma, bildirimler |
| `ezan-vakti@mehmetakbulut.com.tr/prefs.js` | Ayarlar penceresi (Adw) |
| `ezan-vakti@mehmetakbulut.com.tr/schemas/` | GSettings şeması (`org.gnome.shell.extensions.ezan-vakti`) |
| `tools/pack.sh` | `dist/` altına dağıtım zip'i üretir |
| `tools/install.sh` | Paketler ve `gnome-extensions install --force` ile kurar |
| `tools/ezan-reload` | Oturumu kapatmadan yeniden yükleme yardımcısı (aşağıda) |

Kod değişince `tools/install.sh` ile kur. Kurulu dizini repoya symlink yapma: `gnome-extensions uninstall`
symlink'i takip edip repodaki dosyaları silebilir.

### Oturumu kapatmadan yeniden yükleme

GNOME Shell eklenti modüllerini dosya yoluna göre önbelleğe alır; aynı yoldan tekrar yüklemek eski kodu getirir.
`tools/ezan-reload` kurulu eklentiyi her seferinde yeni bir dizine (`~/.cache/ezan-vakti/dev/<zaman>/`) kopyalar.

Bir kere: `ln -s "$PWD/tools/ezan-reload" ~/bin/ezan-reload`

Sonra her değişiklikte `tools/install.sh`, ardından Alt+F2 → `lg` (Looking Glass) → şunu çalıştır:

```js
(async()=>{const em=Main.extensionManager,u='ezan-vakti@mehmetakbulut.com.tr';const [,o]=GLib.spawn_command_line_sync(GLib.get_home_dir()+'/bin/ezan-reload');const p=new TextDecoder().decode(o);const x=em.lookup(u);if(x)await em.unloadExtension(x);await em.loadExtension(em.createExtensionObject(u,Gio.File.new_for_path(p),2));})()
```

Not: `metadata.json` içindeki `version` değişirse GNOME aynı oturumda yeniden yüklemeyi reddeder; o zaman oturumu kapatıp aç.

### Veri kaynağı

`https://namazvakitleri.diyanet.gov.tr/tr-TR/<ilçe_id>` sayfasındaki haftalık, aylık ve yıllık tablolar
ayrıştırılır ve `~/.cache/ezan-vakti/<ilçe_id>.json`'a yazılır. Konum listeleri ve yedek vakitler
`https://ezanvakti.emushaf.net` (`/ulkeler`, `/sehirler/<ülke>`, `/ilceler/<il>`, `/vakitler/<ilçe>`) üzerinden gelir.
Diyanet'in resmi Awqat Salah API'si kayıt gerektirdiği için kullanılmıyor.

## Lisans

GPL-2.0-or-later — bkz. [LICENSE](LICENSE). Copyright (C) 2026 Mehmet Akbulut.
