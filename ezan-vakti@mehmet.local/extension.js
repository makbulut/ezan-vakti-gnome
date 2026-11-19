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
const ILCE_ID = '9545';      // PENDİK
const CITY = 'PENDİK';
const DIYANET_URL = `https://namazvakitleri.diyanet.gov.tr/tr-TR/${ILCE_ID}`;
const MIRROR_URL = `https://ezanvakti.emushaf.net/vakitler/${ILCE_ID}`;
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
const CACHE_FILE = GLib.build_filenamev([CACHE_DIR, `${ILCE_ID}.json`]);

const VAKITLER = [
    ['Imsak', 'İmsak'], ['Gunes', 'Güneş'], ['Ogle', 'Öğle'],
    ['Ikindi', 'İkindi'], ['Aksam', 'Akşam'], ['Yatsi', 'Yatsı'],
];

const NOTIFY_MIN = 10;              // ezana kaç dk kala bildirim
const NO_NOTIFY = ['Güneş'];        // ezan okunmayan vakit
const KERAHAT_MIN = 45;             // Diyanet: akşamdan ~45 dk önce kerahat başlar
const KERAHAT_NOTIFY_MIN = 10;      // kerahate kaç dk kala bildirim

const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

// Her yüklemede benzersiz GType adı: logout'suz yeniden yüklemede (ezan-reload) çakışmasın
const EzanIndicator = GObject.registerClass({GTypeName: `EzanIndicator_${Date.now()}`},
class EzanIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Ezan Vakti');
        this._days = {};
        this._session = new Soup.Session({timeout: 20});
        this._fetching = false;
        this._lastFetchTry = 0;

        const box = new St.BoxLayout({style_class: 'ezan-pill', y_align: Clutter.ActorAlign.CENTER});
        const mk = cls => {
            const l = new St.Label({style_class: cls, y_align: Clutter.ActorAlign.CENTER});
            box.add_child(l);
            return l;
        };
        mk('ezan-city').text = CITY;
        mk('ezan-dot').text = '  ·  ';
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

        this._loadCache();
        this._tick();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _ingest(arr) {
        for (const d of arr)
            if (d.MiladiTarihKisa) this._days[d.MiladiTarihKisa] = d;
    }

    _loadCache() {
        try {
            const [ok, bytes] = GLib.file_get_contents(CACHE_FILE);
            if (ok) this._ingest(JSON.parse(new TextDecoder().decode(bytes)));
        } catch (_) {}
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
        try {
            GLib.mkdir_with_parents(CACHE_DIR, 0o755);
            GLib.file_set_contents(CACHE_FILE, JSON.stringify(Object.values(this._days)));
        } catch (e) {
            console.warn(`[ezan-vakti] cache yazılamadı: ${e.message}`);
        }
        console.log(`[ezan-vakti] ${arr.length} gün alındı (${source})`);
        this._tick();
    }

    _fetch(force = false) {
        const now = Date.now();
        if (!this._session || this._fetching || (!force && now - this._lastFetchTry < 60 * 60 * 1000)) return;
        this._fetching = true;
        this._lastFetchTry = now;
        this._get(DIYANET_URL, html => {
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
            this._get(MIRROR_URL, text => {
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
        if (!this._days[dayKey(now)] || !this._days[dayKey(in3)]) this._fetch();

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
            if (mins <= NOTIFY_MIN && this._notified !== key && !NO_NOTIFY.includes(next.name)) {
                this._notified = key;
                Main.notify(`${next.name} ezanına ${mins} dk kaldı`, `${CITY} · ${next.name} ${next.str}`);
            }
        } else {
            this._next.text = '?';
            this._left.text = '—';
        }

        const aksam = today.find(v => v.name === 'Akşam');
        if (aksam) {
            const kerahat = new Date(aksam.t.getTime() - KERAHAT_MIN * 60000);
            const kMins = Math.ceil((kerahat - now) / 60000);
            const kKey = dayKey(now);
            if (kMins > 0 && kMins <= KERAHAT_NOTIFY_MIN && this._notifiedKerahat !== kKey) {
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
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = 0;
        this._session?.abort();
        this._session = null;
        super.destroy();
    }
});

export default class EzanVaktiExtension extends Extension {
    enable() {
        this._indicator = new EzanIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }
    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
