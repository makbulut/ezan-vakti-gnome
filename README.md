# Ezan Vakti (GNOME Shell eklentisi)

Üst çubukta bir sonraki ezan vaktini ve kalan süreyi gösterir. Vakitler Diyanet'in
kendi sitesinden (namazvakitleri.diyanet.gov.tr) alınır; yedek kaynak ezanvakti.emushaf.net.

- Ezana 10 dk kala bildirim (Güneş hariç)
- Kerahat vaktinden 10 dk önce ikindi hatırlatması (Akşam − 45 dk)
- Menüde günün vakitleri, "Vakitleri yenile"
- Veriler `~/.cache/ezan-vakti/<ilce>.json` içinde saklanır

Test edilen: GNOME Shell 50 (Ubuntu, Wayland).

## Kurulum (geliştirme)

Kurulu dizin repoya symlink DEĞİL; kod değişince paket üretilip normal eklenti gibi kurulur:

    tools/install.sh        # pack + gnome-extensions install --force

İlk kurulumda `gnome-extensions enable ezan-vakti@mehmetakbulut.com.tr` (veya logout/login).

## Logout'suz yeniden yükleme

`tools/ezan-reload` (~/bin/ezan-reload symlink) kurulu eklentiyi her seferinde yeni bir dizine kopyalar
(GJS modül cache'ini aşmak için). Alt+F2 → `lg` → şunu çalıştır:

    (async()=>{const em=Main.extensionManager,u='ezan-vakti@mehmetakbulut.com.tr';const [,o]=GLib.spawn_command_line_sync(GLib.get_home_dir()+'/bin/ezan-reload');const p=new TextDecoder().decode(o);const x=em.lookup(u);if(x)await em.unloadExtension(x);await em.loadExtension(em.createExtensionObject(u,Gio.File.new_for_path(p),2));})()

Not: `metadata.json` içindeki `version` değişirse GNOME yeniden yüklemeyi reddeder; o zaman logout gerekir.

## Paketleme

    tools/pack.sh      # dist/ezan-vakti@mehmetakbulut.com.tr.shell-extension.zip

Karşı tarafta:

    gnome-extensions install ezan-vakti@mehmetakbulut.com.tr.shell-extension.zip
    # logout/login, sonra:
    gnome-extensions enable ezan-vakti@mehmetakbulut.com.tr

## Ayarlar

Panel menüsü → **Ayarlar** (veya `gnome-extensions prefs ezan-vakti@mehmetakbulut.com.tr`):
ülke / il / ilçe seçimi (Diyanet kodları), konum adını gösterme, ezan bildirimi (dk, Güneş dahil mi),
kerahat hatırlatması (kerahat başlangıcı ve bildirim dk). Ayarlar GSettings'te:
`org.gnome.shell.extensions.ezan-vakti` (schema `schemas/` altında; geliştirmede
`glib-compile-schemas ezan-vakti@mehmetakbulut.com.tr/schemas` çalıştır).

## Lisans

GPL-2.0-or-later — bkz. [LICENSE](LICENSE). Copyright (C) 2026 Mehmet Akbulut.
