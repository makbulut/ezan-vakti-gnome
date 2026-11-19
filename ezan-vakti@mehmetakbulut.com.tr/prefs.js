// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Mehmet Akbulut

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import GObject from 'gi://GObject';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Konum listeleri (Diyanet kodları) ezanvakti.emushaf.net üzerinden alınır.
const API = 'https://ezanvakti.emushaf.net';

function fetchJson(session, url) {
    return new Promise((resolve, reject) => {
        const msg = Soup.Message.new('GET', url);
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
            try {
                const bytes = s.send_and_read_finish(res);
                if (msg.get_status() !== 200) throw new Error(`HTTP ${msg.get_status()}`);
                resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
            } catch (e) {
                reject(e);
            }
        });
    });
}

// Aranabilir ComboRow; items = [{id, name}]
class LocationRow {
    constructor(title) {
        this.items = [];
        this.model = new Gtk.StringList();
        this.row = new Adw.ComboRow({
            title,
            model: this.model,
            enable_search: true,
            expression: new Gtk.PropertyExpression(Gtk.StringObject, null, 'string'),
            sensitive: false,
        });
    }

    set(items, selectedId) {
        this.items = items;
        this.model.splice(0, this.model.get_n_items(), items.map(i => i.name));
        let idx = items.findIndex(i => i.id === selectedId);
        if (idx < 0) idx = 0;
        this.row.selected = idx;
        this.row.sensitive = items.length > 0;
        return items[idx];
    }

    get selected() {
        return this.items[this.row.selected];
    }
}

export default class EzanVaktiPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const session = new Soup.Session({timeout: 20});
        window.set_default_size(560, 680);

        const page = new Adw.PreferencesPage({title: 'Ezan Vakti', icon_name: 'preferences-system-time-symbolic'});
        window.add(page);

        // ---- Konum ----
        const loc = new Adw.PreferencesGroup({
            title: 'Konum',
            description: 'Vakitler Diyanet İşleri Başkanlığı verilerinden alınır.',
        });
        page.add(loc);
        const country = new LocationRow('Ülke');
        const city = new LocationRow('İl / Şehir');
        const district = new LocationRow('İlçe');
        [country, city, district].forEach(r => loc.add(r.row));
        const status = new Adw.ActionRow({title: 'Konumlar yükleniyor…', subtitle: '', visible: true});
        loc.add(status);

        let busy = true;   // programatik doldurma sırasında kaydetme yapma
        const showError = e => {
            status.title = 'Konum listesi alınamadı';
            status.subtitle = `${e.message} — internet bağlantını kontrol et`;
            status.visible = true;
        };

        const loadDistricts = async (cityId, selectedId) => {
            district.row.sensitive = false;
            const list = await fetchJson(session, `${API}/ilceler/${cityId}`);
            const sel = district.set(list.map(x => ({id: x.IlceID, name: x.IlceAdi})), selectedId);
            return sel;
        };
        const loadCities = async (countryId, selectedId) => {
            city.row.sensitive = false;
            const list = await fetchJson(session, `${API}/sehirler/${countryId}`);
            return city.set(list.map(x => ({id: x.SehirID, name: x.SehirAdi})), selectedId);
        };
        const save = () => {
            const c = country.selected, s = city.selected, d = district.selected;
            if (!c || !s || !d) return;
            settings.set_string('country-id', c.id);
            settings.set_string('city-id', s.id);
            settings.set_string('district-name', d.name);
            settings.set_string('district-id', d.id);   // en son: eklenti bunu dinliyor
        };
        const guarded = fn => async () => {
            if (busy) return;
            busy = true;
            try {
                await fn();
                save();
                status.visible = false;
            } catch (e) {
                showError(e);
            } finally {
                busy = false;
            }
        };

        country.row.connect('notify::selected', guarded(async () => {
            const s = await loadCities(country.selected.id, null);
            if (s) await loadDistricts(s.id, null);
        }));
        city.row.connect('notify::selected', guarded(async () => {
            await loadDistricts(city.selected.id, null);
        }));
        district.row.connect('notify::selected', guarded(async () => {}));

        (async () => {
            try {
                const list = await fetchJson(session, `${API}/ulkeler`);
                const c = country.set(list.map(x => ({id: x.UlkeID, name: x.UlkeAdi})), settings.get_string('country-id'));
                const s = await loadCities(c.id, settings.get_string('city-id'));
                if (s) await loadDistricts(s.id, settings.get_string('district-id'));
                status.visible = false;
            } catch (e) {
                showError(e);
            } finally {
                busy = false;
            }
        })();

        const showCity = new Adw.SwitchRow({title: 'Konum adını panelde göster'});
        settings.bind('show-city', showCity, 'active', Gio.SettingsBindFlags.DEFAULT);
        loc.add(showCity);

        // ---- Ezan bildirimi ----
        const notif = new Adw.PreferencesGroup({title: 'Ezan bildirimi'});
        page.add(notif);
        const nOn = new Adw.SwitchRow({title: 'Ezandan önce bildirim gönder'});
        settings.bind('notify-enabled', nOn, 'active', Gio.SettingsBindFlags.DEFAULT);
        notif.add(nOn);
        const nMin = Adw.SpinRow.new_with_range(1, 120, 1);
        nMin.title = 'Kaç dakika önce';
        settings.bind('notify-minutes', nMin, 'value', Gio.SettingsBindFlags.DEFAULT);
        notif.add(nMin);
        const nGunes = new Adw.SwitchRow({title: 'Güneş vakti için de bildir', subtitle: 'Güneş vaktinde ezan okunmaz'});
        settings.bind('notify-gunes', nGunes, 'active', Gio.SettingsBindFlags.DEFAULT);
        notif.add(nGunes);
        for (const w of [nMin, nGunes])
            nOn.bind_property('active', w, 'sensitive', GObject.BindingFlags.SYNC_CREATE);

        // ---- Kerahat ----
        const ker = new Adw.PreferencesGroup({
            title: 'Kerahat vakti (ikindi hatırlatması)',
            description: 'Güneş batmadan önceki kerahat vakti girmeden ikindiyi hatırlatır.',
        });
        page.add(ker);
        const kOn = new Adw.SwitchRow({title: 'Kerahat öncesi hatırlat'});
        settings.bind('kerahat-enabled', kOn, 'active', Gio.SettingsBindFlags.DEFAULT);
        ker.add(kOn);
        const kStart = Adw.SpinRow.new_with_range(10, 90, 1);
        kStart.title = 'Kerahat akşamdan kaç dakika önce başlar';
        kStart.subtitle = 'Diyanet: yaklaşık 45 dakika';
        settings.bind('kerahat-minutes', kStart, 'value', Gio.SettingsBindFlags.DEFAULT);
        ker.add(kStart);
        const kNotify = Adw.SpinRow.new_with_range(1, 60, 1);
        kNotify.title = 'Kerahatten kaç dakika önce bildir';
        settings.bind('kerahat-notify-minutes', kNotify, 'value', Gio.SettingsBindFlags.DEFAULT);
        ker.add(kNotify);
        for (const w of [kStart, kNotify])
            kOn.bind_property('active', w, 'sensitive', GObject.BindingFlags.SYNC_CREATE);

        window.connect('close-request', () => {
            session.abort();
            return false;
        });
    }
}
