# Ezan Vakti (GNOME Shell eklentisi)

Üst çubukta bir sonraki ezan vaktini ve kalan süreyi gösterir. Vakitler Diyanet'in
kendi sitesinden (namazvakitleri.diyanet.gov.tr) alınır; yedek kaynak ezanvakti.emushaf.net.

- Ezana 10 dk kala bildirim (Güneş hariç)
- Kerahat vaktinden 10 dk önce ikindi hatırlatması (Akşam − 45 dk)
- Menüde günün vakitleri, "Vakitleri yenile"
- Veriler `~/.cache/ezan-vakti/<ilce>.json` içinde saklanır

Test edilen: GNOME Shell 50 (Ubuntu, Wayland).

## Kurulum (geliştirme)

Kurulu eklenti dizini bu repodaki dizine symlink:

    ln -s ~/workspace/mehmet/ezan-vakti-gnome/ezan-vakti@mehmetakbulut.com.tr \
          ~/.local/share/gnome-shell/extensions/ezan-vakti@mehmetakbulut.com.tr
    gnome-extensions enable ezan-vakti@mehmetakbulut.com.tr   # yeni kurulumda önce logout/login

## Logout'suz yeniden yükleme

`tools/ezan-reload` (~/bin/ezan-reload symlink) eklentiyi her seferinde yeni bir dizine kopyalar
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

`extension.js` başındaki sabitler: `ILCE_ID`, `CITY`, `NOTIFY_MIN`, `NO_NOTIFY`,
`KERAHAT_MIN`, `KERAHAT_NOTIFY_MIN`. İlçe kodları: https://ezanvakti.emushaf.net/ilceler/<il_id>
(İstanbul = 539, Pendik = 9545).
