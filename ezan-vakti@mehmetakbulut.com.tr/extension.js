// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Mehmet Akbulut

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Birincil kaynak: Diyanet'in kendi sitesi (haftalık + aylık + yıllık tablo).
// Yedek: ezanvakti.emushaf.net (Diyanet verisinin aynası, ~30 gün).
// Konum ve bildirim ayarları GSettings'te (prefs.js).
const diyanetUrl = id => `https://namazvakitleri.diyanet.gov.tr/tr-TR/${id}`;
const mirrorUrl = id => `https://ezanvakti.emushaf.net/vakitler/${id}`;
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz',
    'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const stripTags = h => h.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Diyanet sayfasındaki tüm vakit tablolarını mirror formatına çevir
function parseDiyanetHtml(html) {
    const out = [];
    for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => stripTags(m[1]));
        if (cells.length < 8) continue;
        const dm = cells[0].match(/^(\d{1,2}) (\S+) (\d{4})/);
        const mon = dm ? AYLAR.indexOf(dm[2]) : -1;
        if (mon < 0 || !cells.slice(2, 8).every(c => /^\d{1,2}:\d{2}$/.test(c))) continue;
        const [Imsak, Gunes, Ogle, Ikindi, Aksam, Yatsi] = cells.slice(2, 8);
        out.push({
            MiladiTarihKisa: `${dm[1].padStart(2, '0')}.${String(mon + 1).padStart(2, '0')}.${dm[3]}`,
            MiladiTarihUzun: cells[0], HicriTarihUzun: cells[1],
            Imsak, Gunes, Ogle, Ikindi, Aksam, Yatsi,
        });
    }
    return out;
}
const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'ezan-vakti']);
const cacheFile = id => GLib.build_filenamev([CACHE_DIR, `${id}.json`]);

const VAKITLER = [
    ['Imsak', 'İmsak'], ['Gunes', 'Güneş'], ['Ogle', 'Öğle'],
    ['Ikindi', 'İkindi'], ['Aksam', 'Akşam'], ['Yatsi', 'Yatsı'],
];

const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

// Her yüklemede benzersiz GType adı: logout'suz yeniden yüklemede (ezan-reload) çakışmasın
const EzanIndicator = GObject.registerClass({GTypeName: `EzanIndicator_${Date.now()}`},
class EzanIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'Ezan Vakti');
        this._ext = ext;
        this._settings = ext.getSettings();
        this._ilce = this._settings.get_string('district-id');
        this._gen = 0;
        this._days = {};
        this._session = new Soup.Session({timeout: 20});
        this._cancellable = new Gio.Cancellable();
        this._cacheReady = false;
        this._fetching = false;
        this._lastFetchTry = 0;

        const box = new St.BoxLayout({style_class: 'ezan-pill', y_align: Clutter.ActorAlign.CENTER});
        const mk = cls => {
            const l = new St.Label({style_class: cls, y_align: Clutter.ActorAlign.CENTER});
            box.add_child(l);
            return l;
        };
        this._city = mk('ezan-city');
        this._dot = mk('ezan-dot');
        this._dot.text = '  ·  ';
        this._next = mk('ezan-next');
        mk('ezan-left').text = '    Kalan: ';
        this._left = mk('ezan-leftv');
        this.add_child(box);
        this._next.text = '…';

        this._header = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._header);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._rows = VAKITLER.map(([, name]) => {
            const item = new PopupMenu.PopupMenuItem(name, {reactive: false});
            const t = new St.Label({x_expand: true, x_align: Clutter.ActorAlign.END});
            item.add_child(t);
            this.menu.addMenuItem(item);
            return {item, t};
        });
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refresh = new PopupMenu.PopupMenuItem('Vakitleri yenile');
        refresh.connect('activate', () => this._fetch(true));
        this.menu.addMenuItem(refresh);
        const prefs = new PopupMenu.PopupMenuItem('Ayarlar');
        prefs.connect('activate', () => this._ext.openPreferences());
        this.menu.addMenuItem(prefs);

        this._updateCity();
        this._settingsIds = [
            this._settings.connect('changed::district-id', () => this._onDistrictChanged()),
            this._settings.connect('changed::district-name', () => this._updateCity()),
            this._settings.connect('changed::show-city', () => this._updateCity()),
            this._settings.connect('changed', () => this._tick()),
        ];

        this._loadCache();
        this._tick();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _updateCity() {
        const show = this._settings.get_boolean('show-city');
        this._city.text = this._settings.get_string('district-name');
        this._city.visible = show;
        this._dot.visible = show;
    }

    _onDistrictChanged() {
        const id = this._settings.get_string('district-id');
        if (!id || id === this._ilce) return;
        this._ilce = id;
        this._gen++;                 // yoldaki eski istekleri geçersiz kıl
        this._fetching = false;
        this._days = {};
        this._notified = this._notifiedKerahat = null;
        this._loadCache();
        this._fetch(true);
        this._tick();
    }

    _ingest(arr) {
        for (const d of arr)
            if (d.MiladiTarihKisa) this._days[d.MiladiTarihKisa] = d;
    }

    // Önbelleği asenkron oku; bitince ekranı güncelle ve gerekirse indir
    _loadCache() {
        const gen = this._gen;
        this._cacheReady = false;
        const file = Gio.File.new_for_path(cacheFile(this._ilce));
        file.load_contents_async(this._cancellable, (f, res) => {
            if (!this._session || gen !== this._gen) return;
            try {
                const [, bytes] = f.load_contents_finish(res);
                this._ingest(JSON.parse(new TextDecoder().decode(bytes)));
            } catch (_) {
                // önbellek yok veya bozuk: internetten indirilecek
            }
            this._cacheReady = true;
            this._tick();
        });
    }

    _saveCache() {
        const id = this._ilce;
        const data = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(Object.values(this._days))));
        const write = () => {
            Gio.File.new_for_path(cacheFile(id)).replace_contents_bytes_async(
                data, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, this._cancellable, (f, res) => {
                    try {
                        f.replace_contents_finish(res);
                    } catch (e) {
                        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                            console.warn(`[ezan-vakti] önbellek yazılamadı: ${e.message}`);
                    }
                });
        };
        Gio.File.new_for_path(CACHE_DIR).make_directory_async(GLib.PRIORITY_DEFAULT, this._cancellable, (d, res) => {
            try {
                d.make_directory_finish(res);
            } catch (_) {
                // zaten var
            }
            if (this._session) write();
        });
    }

    _get(url, cb) {
        const msg = Soup.Message.new('GET', url);
        msg.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) ezan-vakti-gnome');
        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
            let text = null;
            try {
                const bytes = s.send_and_read_finish(res);
                if (msg.get_status() !== 200) throw new Error(`HTTP ${msg.get_status()}`);
                text = new TextDecoder().decode(bytes.get_data());
            } catch (e) {
                console.warn(`[ezan-vakti] ${url}: ${e.message}`);
            }
            cb(text);
        });
    }

    _store(arr, source) {
        for (const d of arr) this._days[d.MiladiTarihKisa] = d;
        this._saveCache();
        console.log(`[ezan-vakti] ${arr.length} gün alındı (${source})`);
        this._tick();
    }

    _fetch(force = false) {
        const now = Date.now();
        if (!this._session || this._fetching || (!force && now - this._lastFetchTry < 60 * 60 * 1000)) return;
        this._fetching = true;
        this._lastFetchTry = now;
        const gen = this._gen, id = this._ilce;
        this._get(diyanetUrl(id), html => {
            if (gen !== this._gen || !this._session) return;
            const arr = html ? parseDiyanetHtml(html) : [];
            if (arr.length) {
                this._store(arr, 'diyanet');
                const d = new Date();
                const in3 = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3);
                if (this._days[dayKey(in3)]) {
                    this._fetching = false;
                    return;
                }
                console.log('[ezan-vakti] Diyanet sayfasında ileri tarih yok, yedek kaynaktan tamamlanıyor');
            } else {
                console.warn('[ezan-vakti] Diyanet sayfası okunamadı, yedek kaynağa geçiliyor');
            }
            this._get(mirrorUrl(id), text => {
                if (gen !== this._gen || !this._session) return;
                this._fetching = false;
                try {
                    const arr2 = JSON.parse(text).filter(d => d.MiladiTarihKisa);
                    if (arr2.length) this._store(arr2, 'mirror');
                } catch (_) {}
            });
        });
    }

    _times(date) {
        const d = this._days[dayKey(date)];
        if (!d) return null;
        return VAKITLER.map(([k, name]) => {
            const [h, m] = d[k].split(':').map(Number);
            const t = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
            return {name, str: d[k], t};
        });
    }

    _tick() {
        const now = new Date();
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const in3 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
        if (this._cacheReady && (!this._days[dayKey(now)] || !this._days[dayKey(in3)])) this._fetch();

        const today = this._times(now);
        if (!today) {
            this._next.text = 'Vakitler yükleniyor';
            this._left.text = '—';
            return;
        }
        let next = today.find(v => v.t > now);
        if (!next) {
            const tm = this._times(tomorrow);
            next = tm ? tm[0] : null;
        }
        if (next) {
            const mins = Math.ceil((next.t - now) / 60000);
            const h = Math.floor(mins / 60), m = mins % 60;
            this._next.text = `${next.name} ${next.str}`;
            this._left.text = h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
            const key = `${dayKey(next.t)} ${next.name}`;
            const st = this._settings;
            if (st.get_boolean('notify-enabled') && mins <= st.get_int('notify-minutes') &&
                this._notified !== key && (next.name !== 'Güneş' || st.get_boolean('notify-gunes'))) {
                this._notified = key;
                const title = next.name === 'Güneş' ? `Güneş doğuşuna ${mins} dk kaldı` : `${next.name} ezanına ${mins} dk kaldı`;
                Main.notify(title, `${st.get_string('district-name')} · ${next.name} ${next.str}`);
            }
        } else {
            this._next.text = '?';
            this._left.text = '—';
        }

        const aksam = today.find(v => v.name === 'Akşam');
        if (aksam && this._settings.get_boolean('kerahat-enabled')) {
            const kerahat = new Date(aksam.t.getTime() - this._settings.get_int('kerahat-minutes') * 60000);
            const kMins = Math.ceil((kerahat - now) / 60000);
            const kKey = dayKey(now);
            if (kMins > 0 && kMins <= this._settings.get_int('kerahat-notify-minutes') && this._notifiedKerahat !== kKey) {
                this._notifiedKerahat = kKey;
                Main.notify(`Kerahat vaktine ${kMins} dk kaldı`,
                    `İkindiyi kılmadıysan acele et · Kerahat ${pad(kerahat.getHours())}:${pad(kerahat.getMinutes())} (Akşam ${aksam.str})`);
            }
        }

        const info = this._days[dayKey(now)];
        this._header.label.text = `${info.MiladiTarihUzun}  •  ${info.HicriTarihUzun}`;
        today.forEach((v, i) => {
            const r = this._rows[i];
            r.t.text = v.str;
            const isNext = next && v.t.getTime() === next.t.getTime();
            if (isNext) { r.item.label.add_style_class_name('ezan-row-next'); r.t.add_style_class_name('ezan-row-next'); }
            else { r.item.label.remove_style_class_name('ezan-row-next'); r.t.remove_style_class_name('ezan-row-next'); }
        });
    }

    destroy() {
        this._settingsIds?.forEach(i => this._settings.disconnect(i));
        this._settingsIds = null;
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = 0;
        this._cancellable?.cancel();
        this._cancellable = null;
        this._session?.abort();
        this._session = null;
        this._settings = null;
        super.destroy();
    }
});

export default class EzanVaktiExtension extends Extension {
    enable() {
        this._indicator = new EzanIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }
    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
