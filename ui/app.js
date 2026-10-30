/* Dock TV UI. Plain JS; all text from the TV is inserted with textContent, never as HTML. */
(function () {
  'use strict';
  var api = window.dock;
  var view = document.getElementById('view');
  var nav = document.getElementById('nav');

  // ---------- helpers ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  var toastTimer;
  function toast(msg, err) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 5000);
  }
  function fail(e) { toast(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
  function busy(btn, label, fn) {
    var old = btn.textContent;
    btn.disabled = true; btn.textContent = label;
    return Promise.resolve().then(fn).catch(fail).then(function (r) { btn.disabled = false; btn.textContent = old; return r; });
  }
  function compatChip(c) {
    var labels = { verified: 'Tested on this model', likely: 'Same generation as tested TV', untested: 'Untested model', unknown: 'Unknown model' };
    return h('span', { class: 'chip ' + c.level }, labels[c.level] || c.level);
  }
  function link(text, url) { return h('button', { class: 'link', onclick: function () { api.open.link(url).catch(fail); } }, text); }

  // ---------- navigation ----------
  var VIEWS = [
    { id: 'connect', name: 'Find your TV', fn: viewConnect },
    { id: 'backup', name: 'Back up', fn: viewBackup },
    { id: 'privacy', name: 'Privacy clean-up', fn: viewPrivacy },
    { id: 'design', name: 'Design your Dock', fn: viewDesign },
    { id: 'install', name: 'Install', fn: viewInstall },
    { id: 'restore', name: 'Restore', fn: viewRestore },
  ];
  var current = null;
  var offs = [];
  var progress = {};

  function go(id) {
    offs.forEach(function (o) { o(); });
    offs = [];
    current = id;
    Array.prototype.forEach.call(nav.children, function (b) { b.classList.toggle('on', b.getAttribute('data-id') === id); });
    clear(view);
    var v = VIEWS.filter(function (x) { return x.id === id; })[0];
    v.fn();
    view.scrollTop = 0;
  }
  window.__go = go;

  VIEWS.forEach(function (v, i) {
    nav.appendChild(h('button', { class: 'nav-item', 'data-id': v.id, onclick: function () { go(v.id); } }, h('span', { class: 'n' }, i + 1), v.name));
  });

  function header(title, lead) { view.appendChild(h('h1', null, title)); view.appendChild(h('p', { class: 'lead' }, lead)); }

  // ---------- 1. connect ----------
  function viewConnect() {
    header('Find your TV', 'Dock TV looks for Samsung TVs on the same router as this PC. Switch the TV fully on (not standby) first.');
    var saved = h('div');
    var results = h('div');
    var prog = h('div', { class: 'bar', hidden: true }, h('i'));
    var status = h('p', { class: 'small' });
    var ipBox = h('input', { type: 'text', placeholder: 'e.g. 192.168.1.50', size: '18' });

    function tvCard(tv, withUse) {
      return h('div', { class: 'card' },
        h('div', { class: 'row sp' },
          h('div', null, h('h2', null, tv.model || 'Samsung TV'), h('p', { class: 'small' }, (tv.name || '') + ' · ' + tv.ip + (tv.networkType ? ' · ' + tv.networkType : ''))),
          compatChip(tv.compat)),
        h('p', { class: 'small', style: 'margin-top:8px' }, tv.compat.text),
        withUse ? h('div', { class: 'row', style: 'margin-top:12px' },
          h('button', { class: 'btn primary', onclick: function () { api.tv.select(tv).then(function () { toast('TV saved.'); renderSaved(); results.textContent = ''; }).catch(fail); } }, 'Use this TV')) : null);
    }
    function renderSaved() {
      clear(saved);
      api.tv.saved().then(function (tv) {
        if (!tv) return;
        saved.appendChild(h('h2', { style: 'margin:6px 0 8px' }, 'Selected TV'));
        saved.appendChild(tvCard(tv, false));
        saved.appendChild(h('div', { class: 'row', style: 'margin-bottom:18px' },
          h('button', { class: 'btn primary', onclick: function () { go('backup'); } }, 'Next: back up'),
          h('button', { class: 'btn', onclick: function () { api.tv.forget().then(renderSaved); } }, 'Forget this TV')));
      });
    }
    var scanBtn = h('button', { class: 'btn primary' }, 'Scan my network');
    scanBtn.onclick = function () {
      results.textContent = ''; status.textContent = ''; prog.hidden = false; prog.firstChild.style.width = '0';
      busy(scanBtn, 'Scanning…', function () {
        return api.tv.scan().then(function (tvs) {
          prog.hidden = true;
          if (!tvs.length) { status.textContent = 'No Samsung TV answered. Check the TV is on (not standby) and on the same router (not a guest network), or type its IP below.'; return; }
          status.textContent = tvs.length + ' Samsung TV' + (tvs.length > 1 ? 's' : '') + ' found.';
          tvs.forEach(function (tv) { results.appendChild(tvCard(tv, true)); });
        });
      });
    };
    offs.push(api.on('tv:progress', function (p) { prog.firstChild.style.width = Math.round(p * 100) + '%'; }));
    var probeBtn = h('button', { class: 'btn' }, 'Check this IP');
    probeBtn.onclick = function () {
      busy(probeBtn, 'Checking…', function () {
        return api.tv.probe(ipBox.value.trim()).then(function (tv) {
          results.textContent = '';
          if (!tv) { status.textContent = 'No Samsung TV answered at that address.'; return; }
          status.textContent = '';
          results.appendChild(tvCard(tv, true));
        });
      });
    };
    api.tv.pc().then(function (pc) {
      status.textContent = pc ? 'This PC: ' + pc.ip + ' (' + pc.iface + ')' : 'No home network detected. Connect this PC to the same router as the TV.';
    });
    view.appendChild(saved);
    view.appendChild(h('div', { class: 'card' },
      h('div', { class: 'row' }, scanBtn, h('span', { class: 'muted' }, 'or'), ipBox, probeBtn),
      prog, status));
    view.appendChild(results);
    view.appendChild(h('p', { class: 'small' }, 'Tip: the TV shows its IP under Settings > General > Network > Network Status > IP Settings. Give it a fixed address in your router so it keeps it.'));
    renderSaved();
  }

  // ---------- 2. backup ----------
  function viewBackup() {
    header('Back up before changing anything', 'Samsung TVs cannot export their settings, so the backup is the TV’s info page, its app list (once Developer Mode is on) and photos you take of the menus. Every change in the next step also logs its old value.');
    var out = h('div');
    var btn = h('button', { class: 'btn primary' }, 'Back up now');
    btn.onclick = function () {
      busy(btn, 'Backing up…', function () {
        return api.tv.backup().then(function (r) {
          clear(out);
          out.appendChild(h('div', { class: 'note ok' }, 'Saved the TV’s info page. ' + (r.appList ? 'Saved its installed-app list too.' : 'The app list is saved automatically at install time (it needs Developer Mode).')));
          out.appendChild(h('div', { class: 'card' }, h('h2', null, 'Photo checkpoint'),
            h('p', null, 'Take a phone photo of each of these TV screens and keep them with the backup:'),
            h('ul', { style: 'margin:8px 0 0 18px;color:var(--muted)' }, r.photos.map(function (p) { return h('li', null, p); }))));
          out.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: function () { go('privacy'); } }, 'Next: privacy clean-up'), h('button', { class: 'btn', onclick: function () { api.open.folder(); } }, 'Open data folder')));
        });
      });
    };
    view.appendChild(h('div', { class: 'card' }, h('div', { class: 'row' }, btn)));
    view.appendChild(out);
  }

  // ---------- 3. privacy ----------
  function viewPrivacy() {
    header('Privacy clean-up', 'Switch off Samsung’s tracking and ads, one setting at a time. You change each setting with the TV remote; Dock TV logs the old value first so Restore can put it back. Nothing is uninstalled.');
    var list = h('div');
    view.appendChild(h('div', { class: 'note' }, 'Menu names below are from a 2018 TV. On other models they may be worded or placed differently: do what matches your TV, and skip anything you cannot find.'));
    api.steps.list().then(function (data) {
      view.appendChild(h('div', { class: 'note bad' }, data.warning));
      if (!data.hasBackup) view.appendChild(h('div', { class: 'note' }, 'No backup yet. Step 2 first is recommended.'));
      view.appendChild(list);
      draw(data);
    });
    function entryFor(data, id) { return data.log.filter(function (e) { return e.id === id; })[0]; }
    function record(data, e) { return api.steps.record(e).then(function (log) { data.log = log; draw(data); }).catch(fail); }
    function draw(data) {
      clear(list);
      var changed = data.log.filter(function (e) { return e.changed; }).length;
      data.steps.forEach(function (s, i) { list.appendChild(stepCard(data, s, i)); });
      list.appendChild(h('div', { class: 'row', style: 'margin-top:16px' }, h('span', { class: 'muted' }, changed + ' change' + (changed === 1 ? '' : 's') + ' logged.'),
        h('button', { class: 'btn primary', onclick: function () { go('design'); } }, 'Next: design your Dock')));
    }
    function stepCard(data, s, i) {
      var e = entryFor(data, s.id);
      var mk = function (patch) { return Object.assign({ id: s.id, before: '', after: '', changed: false, skipped: false }, patch); };
      var awaiting = e && !e.changed && !e.skipped && e.before !== 'Not present' && e.before !== s.target && (s.kind === 'toggle' || s.kind === 'dns');
      var status = null;
      if (e) {
        if (e.skipped) status = h('span', { class: 'chip' }, 'Skipped');
        else if (e.changed) status = h('span', { class: 'chip verified' }, 'Changed: ' + e.before + ' → ' + e.after);
        else if (e.before === 'Not present') status = h('span', { class: 'chip' }, 'Not on this TV');
        else if (awaiting) status = h('span', { class: 'chip warn' }, 'Old value logged: ' + e.before);
        else status = h('span', { class: 'chip verified' }, s.kind === 'toggle' || s.kind === 'dns' ? 'Already fine' : 'Logged');
      }
      var body = h('div');
      var undo = function () { return h('button', { class: 'link small', onclick: function () { api.steps.reset(s.id).then(function (log) { data.log = log; draw(data); }).catch(fail); } }, 'Undo this answer'); };

      if (!e && s.kind === 'toggle') {
        body.appendChild(h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'What is it set to now?'),
          ['On', 'Off'].map(function (v) { return h('button', { class: 'btn sm', onclick: function () { record(data, mk({ before: v, after: v })); } }, v); }),
          h('button', { class: 'btn sm', onclick: function () { record(data, mk({ before: 'Not present', after: 'Not present' })); } }, 'Not on my TV')));
      } else if (!e && s.kind === 'dns') {
        var sel = h('select', null, h('option', { value: 'a' }, 'Obtain automatically'), h('option', { value: 'm' }, 'Enter manually'));
        var ip = h('input', { type: 'text', placeholder: 'DNS server shown (if manual)', size: '20' });
        body.appendChild(h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'DNS setting now:'), sel, ip,
          h('button', { class: 'btn sm', onclick: function () {
            var before = sel.value === 'a' ? 'Obtain automatically' : 'Enter manually: ' + ip.value.trim();
            record(data, mk({ before: before, after: before }));
          } }, 'Log it')));
      } else if (!e) {
        var ta = h('textarea', { rows: '3', placeholder: s.kind === 'extras' ? 'One item per line: names you switched off' : 'One tile per line: names you removed from the Home bar' });
        body.appendChild(ta);
        body.appendChild(h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { class: 'btn sm primary', onclick: function () {
            var lines = ta.value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
            if (s.kind === 'extras') lines = lines.filter(function (x) { return !/smart hub terms|privacy notice/i.test(x); });
            record(data, mk(s.kind === 'extras'
              ? { before: 'On', after: 'Off', changed: lines.length > 0, items: lines }
              : { before: 'Original Home bar (see your photo)', after: 'Removed: ' + lines.join(', '), changed: lines.length > 0, tiles: lines }));
          } }, 'Log it'),
          h('button', { class: 'btn sm', onclick: function () { record(data, mk({ before: 'On', after: 'On', skipped: true })); } }, 'Nothing to change')));
      } else if (awaiting) {
        var what = s.kind === 'dns' ? 'Choose Enter manually and type 94.140.14.14, then OK. Restart the TV if it asks.' : 'Now set it to ' + s.target + ' on the TV (it was ' + e.before + ').';
        body.appendChild(h('div', { class: 'row' }, h('span', { class: 'small grow' }, what),
          h('button', { class: 'btn sm primary', onclick: function () { record(data, mk({ before: e.before, after: s.target, changed: true })); } }, 'I changed it'),
          h('button', { class: 'btn sm', onclick: function () { record(data, mk({ before: e.before, after: e.before, skipped: true })); } }, 'Skip')));
        body.appendChild(undo());
      } else if (!e.changed) {
        body.appendChild(undo());
      }
      return h('div', { class: 'card' },
        h('div', { class: 'row sp' }, h('h2', null, (i + 1) + '. ' + s.name), status),
        h('p', { class: 'small', style: 'margin:4px 0 2px' }, s.why),
        h('p', { class: 'small' }, 'Where: ', h('code', null, s.path)),
        h('div', { style: 'margin-top:10px' }, body));
    }
  }

  // ---------- 4. design ----------
  function viewDesign() {
    header('Design your Dock', 'Choose what your Dock shows. The preview is the real launcher that gets installed, so weather, buses and prayer times are live.');
    var wrap = h('div', { class: 'design' });
    var left = h('div', { class: 'stage-wrap' });
    var right = h('div');
    wrap.appendChild(left); wrap.appendChild(right);
    view.appendChild(wrap);

    var L = null, tab = 'apps', frame = null, saveTimer = null;

    function reload() { if (frame) frame.src = frame.src; }
    function changed(noReload) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { api.layout.save(L).then(function () { if (!noReload) reload(); }).catch(fail); }, 500);
    }
    offs.push(function () { clearTimeout(saveTimer); if (L) api.layout.save(L); });

    // ---- small controls ----
    function field(label, ctl, hint) { return h('label', { class: 'field' }, h('span', null, label), ctl, hint ? h('div', { class: 'small muted' }, hint) : null); }
    function range(label, obj, key, min, max, step, fmt) {
      var out = h('b', null, fmt ? fmt(obj[key]) : obj[key]);
      var inp = h('input', { type: 'range', min: min, max: max, step: step, value: obj[key] });
      inp.oninput = function () { obj[key] = parseFloat(inp.value); out.textContent = fmt ? fmt(obj[key]) : obj[key]; changed(); };
      return h('label', { class: 'field' }, h('span', null, label, out), inp);
    }
    function check(label, obj, key, after) {
      var c = h('input', { type: 'checkbox' }); c.checked = !!obj[key];
      c.onchange = function () { obj[key] = c.checked; changed(); if (after) after(); };
      return h('label', { class: 'chk' }, c, label);
    }
    function text(obj, key, ph, size) {
      var t = h('input', { type: 'text', value: obj[key] || '', placeholder: ph || '', size: size || '14' });
      t.onchange = function () { obj[key] = t.value.trim(); changed(); };
      return t;
    }
    function timeBox(obj, key) {
      var t = h('input', { type: 'time', value: obj[key] });
      t.onchange = function () { if (t.value) { obj[key] = t.value; changed(); } };
      return t;
    }
    function card(title, enabledObj, children) {
      var head = h('div', { class: 'row sp' }, h('h2', null, title), enabledObj ? check('On', enabledObj, 'enabled', function () { drawRight(); }) : null);
      return h('div', { class: 'card' }, head, children);
    }

    // Reusable "search for a town" control used by weather and prayer times.
    function placePicker(obj) {
      var box = h('div');
      var q = h('input', { type: 'text', placeholder: 'Town or city', value: obj.place || '', style: 'flex:1' });
      var btn = h('button', { class: 'btn sm' }, 'Search');
      var res = h('div');
      function pick(r) { obj.place = r.place; obj.latitude = r.latitude; obj.longitude = r.longitude; obj.timezone = r.timezone; obj.enabled = true; changed(); drawRight(); }
      function search() {
        busy(btn, '…', function () {
          return api.weather.find(q.value).then(function (list) {
            clear(res);
            if (!list.length) res.appendChild(h('p', { class: 'small' }, 'No place found.'));
            list.forEach(function (r) { res.appendChild(h('button', { class: 'btn sm', style: 'display:block;margin:4px 0;text-align:left', onclick: function () { pick(r); } }, r.label)); });
          });
        });
      }
      btn.onclick = search;
      q.onkeydown = function (e) { if (e.key === 'Enter') search(); };
      box.appendChild(h('div', { class: 'row' }, q, btn));
      box.appendChild(res);
      box.appendChild(h('p', { class: 'small' }, obj.latitude == null ? 'Search and pick a place to turn this on.' : 'Using ' + obj.place + ' (' + obj.latitude.toFixed(2) + ', ' + obj.longitude.toFixed(2) + ').'));
      return box;
    }

    // ---- tabs ----
    function drawRight() {
      clear(right);
      if (!L) return;
      var t = h('div', { class: 'tabs' });
      [['apps', 'Apps'], ['widgets', 'Widgets'], ['photos', 'Photos'], ['night', 'Night & idle']].forEach(function (x) {
        t.appendChild(h('button', { class: 'tab' + (tab === x[0] ? ' on' : ''), onclick: function () { tab = x[0]; drawRight(); } }, x[1]));
      });
      right.appendChild(t);
      var box = h('div'); right.appendChild(box);
      ({ apps: appsTab, widgets: widgetsTab, photos: photosTab, night: nightTab })[tab](box);
      right.appendChild(h('div', { class: 'row', style: 'margin-top:14px' },
        h('button', { class: 'btn primary', onclick: function () { api.layout.save(L).then(function () { go('install'); }); } }, 'Next: install'),
        h('button', { class: 'btn sm', onclick: function () { if (confirm('Reset every setting to the defaults?')) api.layout.reset().then(function (l) { L = l; reload(); drawRight(); }); } }, 'Reset')));
    }

    function appsTab(box) {
      var list = h('div', { class: 'applist' });
      L.apps.forEach(function (a, i) {
        list.appendChild(h('div', { class: 'item' }, h('span', { class: 'grow' }, a.name),
          h('button', { class: 'btn sm', disabled: i === 0, onclick: function () { L.apps.splice(i - 1, 0, L.apps.splice(i, 1)[0]); changed(); drawRight(); } }, '↑'),
          h('button', { class: 'btn sm', disabled: i === L.apps.length - 1, onclick: function () { L.apps.splice(i + 1, 0, L.apps.splice(i, 1)[0]); changed(); drawRight(); } }, '↓'),
          h('button', { class: 'btn sm', onclick: function () { L.apps.splice(i, 1); changed(); drawRight(); } }, 'Remove')));
      });
      box.appendChild(list);
      if (L.apps.length >= 8) box.appendChild(h('p', { class: 'small' }, 'The dock holds up to 8 apps.'));
      var pick = h('select', { style: 'width:100%' }, h('option', { value: '' }, 'Add an app…'));
      var tvBox = h('div');
      api.apps.fromTv().then(function (r) {
        r.presets.forEach(function (p, i) { pick.appendChild(h('option', { value: String(i) }, p.name)); });
        pick.onchange = function () {
          if (pick.value === '' || L.apps.length >= 8) return;
          L.apps.push(JSON.parse(JSON.stringify(r.presets[parseInt(pick.value, 10)]))); changed(); drawRight();
        };
        if (r.apps.length) {
          var tvSel = h('select', { style: 'width:100%' }, h('option', { value: '' }, 'Add from apps found on my TV…'));
          r.apps.forEach(function (a, i) { tvSel.appendChild(h('option', { value: String(i) }, a.name)); });
          tvSel.onchange = function () {
            if (tvSel.value === '' || L.apps.length >= 8) return;
            var a = r.apps[parseInt(tvSel.value, 10)];
            L.apps.push({ name: a.name.slice(0, 24), ids: [a.id], match: a.name.toLowerCase(), color: '#1f2a33', text: '#FFFFFF' }); changed(); drawRight();
          };
          tvBox.appendChild(h('div', { class: 'field' }, tvSel));
        } else tvBox.appendChild(h('p', { class: 'small' }, 'Apps found on your TV appear here after the first install (needs Developer Mode). Presets work without it: apps are matched by name on the TV.'));
      });
      box.appendChild(h('div', { class: 'field' }, pick)); box.appendChild(tvBox);
      var name = h('input', { type: 'text', placeholder: 'Name', size: '10' });
      var match = h('input', { type: 'text', placeholder: 'Name on the TV', size: '12' });
      box.appendChild(h('div', { class: 'field' }, h('span', null, 'Custom app'), h('div', { class: 'row' }, name, match,
        h('button', { class: 'btn sm', onclick: function () {
          if (!name.value.trim() || L.apps.length >= 8) return;
          L.apps.push({ name: name.value.trim(), ids: [], match: (match.value || name.value).trim().toLowerCase(), color: '#1f2a33', text: '#FFFFFF' }); changed(); drawRight();
        } }, 'Add'))));

      var inp = L.inputs;
      var ib = h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('h2', null, 'Inputs'), check('Show', inp, 'enabled', drawRight)));
      if (inp.enabled) {
        ib.appendChild(h('p', { class: 'small' }, 'Connected HDMI devices appear next to your apps by themselves. Name them here.'));
        ib.appendChild(check('Live TV tile (the aerial)', inp, 'liveTv'));
        ['HDMI1', 'HDMI2', 'HDMI3', 'HDMI4'].forEach(function (k) {
          var t = h('input', { type: 'text', placeholder: 'e.g. PlayStation', value: inp.labels[k] || '', size: '14' });
          t.onchange = function () { if (t.value.trim()) inp.labels[k] = t.value.trim(); else delete inp.labels[k]; changed(); };
          var hide = h('input', { type: 'checkbox' }); hide.checked = inp.hide.indexOf(k) >= 0;
          hide.onchange = function () { inp.hide = inp.hide.filter(function (x) { return x !== k; }); if (hide.checked) inp.hide.push(k); changed(); };
          ib.appendChild(h('div', { class: 'row', style: 'margin:6px 0' }, h('b', { style: 'width:62px' }, k), t, h('label', { class: 'chk' }, hide, 'Hide')));
        });
      }
      box.appendChild(ib);
    }

    function widgetsTab(box) {
      // Weather
      var w = h('div'); if (L.weather.enabled || L.weather.latitude != null) w.appendChild(h('p', { class: 'small' }, 'Shows the current weather and the next hours (Open-Meteo, no account).'));
      w.appendChild(placePicker(L.weather));
      box.appendChild(card('Weather', L.weather.latitude != null ? L.weather : null, w));

      // London buses
      var b = h('div');
      b.appendChild(h('p', { class: 'small' }, 'London only (Transport for London, no account). Shows the next buses on one line at one stop, during the hours you choose.'));
      var q = h('input', { type: 'text', placeholder: 'Stop or area, e.g. Trafalgar Square', style: 'flex:1' });
      var go2 = h('button', { class: 'btn sm' }, 'Find stops');
      var res = h('div');
      go2.onclick = function () {
        busy(go2, '…', function () {
          return api.bus.find(q.value).then(function (list) {
            clear(res);
            if (!list.length) res.appendChild(h('p', { class: 'small' }, 'No bus stops found.'));
            list.forEach(function (s) {
              s.lines.forEach(function (line) {
                res.appendChild(h('button', { class: 'btn sm', style: 'display:block;margin:4px 0;text-align:left', onclick: function () {
                  Object.assign(L.bus, { enabled: true, line: line, stopId: s.stopId, stopName: s.stopName, stop: s.stop }); changed(); drawRight();
                } }, s.stopName + (s.stop ? ' · ' + s.stop : '') + ' — route ' + line));
              });
            });
          });
        });
      };
      b.appendChild(h('div', { class: 'row' }, q, go2)); b.appendChild(res);
      b.appendChild(h('p', { class: 'small' }, L.bus.stopId ? 'Selected: route ' + L.bus.line + ' at ' + L.bus.stopName + (L.bus.stop ? ' (' + L.bus.stop + ')' : '') : 'Search and pick a stop and route to turn this on.'));
      if (L.bus.stopId) b.appendChild(h('div', { class: 'row' }, h('span', { class: 'small' }, 'Show between'), timeBox(L.bus, 'from'), h('span', { class: 'small' }, 'and'), timeBox(L.bus, 'to')));
      box.appendChild(card('Bus times (London)', L.bus.stopId ? L.bus : null, b));

      // Prayer times
      var p = h('div');
      p.appendChild(h('p', { class: 'small' }, 'Start times from the Aladhan service (no account), fetched once a day. Press 5 on the remote to cycle bus, prayer times, off.'));
      p.appendChild(placePicker(L.prayer));
      var mSel = h('select', null);
      Object.keys(layoutMethods).forEach(function (k) { var o = h('option', { value: k }, layoutMethods[k]); if (String(L.prayer.method) === k) o.selected = true; mSel.appendChild(o); });
      mSel.onchange = function () { L.prayer.method = parseInt(mSel.value, 10); changed(); };
      var sSel = h('select', null, h('option', { value: '0' }, 'Standard (Shafi, Maliki, Hanbali)'), h('option', { value: '1' }, 'Hanafi'));
      sSel.value = String(L.prayer.school); sSel.onchange = function () { L.prayer.school = parseInt(sSel.value, 10); changed(); };
      p.appendChild(field('Calculation method', mSel)); p.appendChild(field('Asr', sSel));
      p.appendChild(field('Fine-tune in minutes (Imsak, Fajr, Sunrise, Dhuhr, Asr, Maghrib, Sunset, Isha, Midnight)', text(L.prayer, 'tune', '0,0,0,0,0,0,0,0,0', '24'),
        'Optional. Use it to match your local mosque timetable; these are start times, not jamaat times.'));
      box.appendChild(card('Prayer times', L.prayer.latitude != null ? L.prayer : null, p));

      // Spotify
      box.appendChild(spotifyCard());

      // Network
      box.appendChild(h('div', { class: 'card' }, h('h2', null, 'Wi-Fi'), h('p', { class: 'small' }, 'The Dock shows the network name and counts connection drops. Press OK on that card for the history and a speed test.'),
        check('Count Wi-Fi drops', L.settings, 'dropLog')));
    }

    var layoutMethods = {};
    var spStatus = { connected: false };

    function spotifyCard() {
      var s = L.spotify;
      var b = h('div');
      b.appendChild(h('p', { class: 'small' }, 'Shows what is playing and lets OK play or pause. Needs Spotify Premium and a free Spotify developer app.'));
      var st = h('p', { class: 'small' }, spStatus.connected ? 'Connected' + (spStatus.name ? ' as ' + spStatus.name : '') + '.' : 'Not connected.');
      b.appendChild(st);
      if (!spStatus.connected) {
        b.appendChild(h('ol', { class: 'help' },
          h('li', null, 'Open the Spotify developer dashboard and create an app.'),
          h('li', null, 'Add this Redirect URI exactly: http://127.0.0.1:8888/callback'),
          h('li', null, 'Paste the app’s Client ID below and press Connect.')));
        var cid = h('input', { type: 'text', placeholder: 'Client ID', value: spStatus.clientId || '', size: '34' });
        var con = h('button', { class: 'btn primary sm' }, 'Connect Spotify');
        con.onclick = function () {
          busy(con, 'Waiting for the browser…', function () {
            return api.spotify.login(cid.value).then(function (r) { spStatus = r; s.enabled = true; changed(); toast('Spotify connected.'); drawRight(); });
          });
        };
        b.appendChild(h('div', { class: 'row' }, cid, con));
        b.appendChild(h('div', { class: 'row', style: 'margin-top:6px' }, link('Open Spotify developer dashboard', 'https://developer.spotify.com/dashboard')));
      } else {
        b.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: function () { api.spotify.forget().then(function (r) { spStatus = r; s.enabled = false; changed(); drawRight(); }); } }, 'Disconnect')));
        var pl = h('input', { type: 'text', placeholder: 'Playlist link (optional)', value: s.playlistUri, size: '34' });
        pl.onchange = function () {
          if (!pl.value.trim()) { s.playlistUri = ''; s.playlistName = ''; changed(); return; }
          api.spotify.uri(pl.value).then(function (uri) { s.playlistUri = uri; changed(); toast('Playlist saved.'); }).catch(fail);
        };
        b.appendChild(field('Playlist to start with OK (optional)', pl));
        b.appendChild(field('Playlist name shown when nothing plays', text(s, 'playlistName', 'your playlist', '24')));
        b.appendChild(field('Preferred Spotify device name', text(s, 'preferDevice', 'Dock TV', '14')));
        b.appendChild(field('Player page (advanced, optional)', text(s, 'sdkPlayerUrl', 'https://yourname.github.io/dock-tv-player/', '34'),
          'An HTTPS page you host that runs Spotify’s Web Playback SDK, which makes the Dock itself a Spotify device. Leave blank to control another device instead.'));
      }
      return card('Spotify', spStatus.connected ? s : null, b);
    }

    function photosTab(box) {
      box.appendChild(photoSet('day', 'Day photos', ['landscapes', 'mountains', 'coasts', 'islands', 'forests', 'space']));
      box.appendChild(photoSet('night', 'Night photos (optional)', ['space', 'mountains', 'coasts']));
      var s = L.settings;
      var o = h('div', { class: 'card' }, h('h2', null, 'Slideshow'));
      o.appendChild(range('Seconds per photo', s, 'wallpaperSeconds', 10, 300, 5));
      o.appendChild(range('Crossfade (ms)', s, 'fadeMs', 0, 6000, 250));
      o.appendChild(check('Slow zoom on each photo (can stutter on older TVs)', s, 'slowZoom'));
      var ic = h('select', null, h('option', { value: 'auto' }, 'Use the TV’s icon when it is sharp'), h('option', { value: 'never' }, 'Always show name tiles'));
      ic.value = s.appIcons; ic.onchange = function () { s.appIcons = ic.value; changed(); };
      o.appendChild(field('App tiles', ic));
      box.appendChild(o);
    }

    function photoSet(kind, title, cats) {
      var names = { landscapes: 'Landscapes', mountains: 'Mountains', coasts: 'Coasts', islands: 'Islands', forests: 'Forests', space: 'Space' };
      var c = h('div', { class: 'card' }, h('h2', null, title));
      var info = h('p', { class: 'small' });
      api.wallpapers.list(kind).then(function (l) { info.textContent = l.length ? l.length + ' photos ready.' : (kind === 'night' ? 'None: night mode darkens your day photos instead.' : 'None yet: a gradient shows until you add some.'); });
      c.appendChild(info);
      var checks = {}, row = h('div', { class: 'row' });
      cats.forEach(function (k, i) { var x = h('input', { type: 'checkbox' }); x.checked = i < 3; checks[k] = x; row.appendChild(h('label', { class: 'chk' }, x, names[k])); });
      var prog = h('div', { class: 'bar', hidden: true }, h('i'));
      var msg = h('p', { class: 'small' });
      offs.push(api.on('wp:progress', function (p) { if (p.total) prog.firstChild.style.width = Math.round(p.done / p.total * 100) + '%'; if (p.text) msg.textContent = p.text; }));
      var dl = h('button', { class: 'btn sm' }, 'Download free photos');
      dl.onclick = function () {
        prog.hidden = false; prog.firstChild.style.width = '0';
        var chosen = Object.keys(checks).filter(function (k) { return checks[k].checked; });
        busy(dl, 'Downloading…', function () { return api.wallpapers.fetch({ kind: kind, categories: chosen, count: kind === 'night' ? 8 : 12 }).then(function (n) { prog.hidden = true; toast(n + ' photos downloaded.'); reload(); drawRight(); }); });
      };
      var own = h('button', { class: 'btn sm' }, 'Use my pictures…');
      own.onclick = function () { prog.hidden = false; busy(own, 'Working…', function () { return api.wallpapers.pickFolder(kind).then(function (n) { prog.hidden = true; if (n) { toast(n + ' pictures added.'); reload(); drawRight(); } }); }); };
      var del = h('button', { class: 'btn sm', onclick: function () { api.wallpapers.clear(kind).then(function () { reload(); drawRight(); }); } }, 'Remove all');
      c.appendChild(row); c.appendChild(h('div', { class: 'row', style: 'margin-top:8px' }, dl, own, del)); c.appendChild(prog); c.appendChild(msg);
      c.appendChild(h('p', { class: 'small muted' }, 'Free photos come from Wikimedia Commons; the photographer is credited on screen. Your own pictures are resized for the TV.'));
      return c;
    }

    function nightTab(box) {
      var n = L.night;
      var c = h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('h2', null, 'Night mode'), check('On', n, 'enabled', drawRight)));
      c.appendChild(h('p', { class: 'small' }, 'A TV app cannot change the backlight, so the Dock lays a dark veil over the screen and uses your night photos if you added any.'));
      if (n.enabled) {
        c.appendChild(h('div', { class: 'row' }, h('span', { class: 'small' }, 'From'), timeBox(n, 'from'), h('span', { class: 'small' }, 'to'), timeBox(n, 'to')));
        c.appendChild(range('Darkness (1 = darkest, 4 = lightest)', n, 'level', 1, 4, 1));
      }
      box.appendChild(c);
      var i = h('div', { class: 'card' }, h('h2', null, 'Idle'));
      i.appendChild(range('Hide the dock after (minutes, 0 = never)', L.settings, 'idleMinutes', 0, 30, 1));
      box.appendChild(i);
    }

    Promise.all([api.appInfo(), api.layout.get(), api.spotify.status(), api.appMeta()]).then(function (r) {
      L = r[1]; spStatus = r[2]; layoutMethods = r[3].prayerMethods;
      frame = h('iframe', { src: r[0].stageUrl, title: 'Dock preview', tabindex: '-1' });
      var stage = h('div', { class: 'stage' }, frame);
      left.appendChild(stage);
      left.appendChild(h('p', { class: 'hint muted' }, 'Preview only: no remote or TV apps here. Buses, weather and prayer times are live.'));
      var fit = function () { frame.style.transform = 'scale(' + (stage.clientWidth / 1920) + ')'; };
      fit();
      var ro = new ResizeObserver(fit); ro.observe(stage); offs.push(function () { ro.disconnect(); });
      drawRight();
    }).catch(fail);
  }


  // ---------- 5. install ----------
  function viewInstall() {
    header('Install on your TV', 'Dock TV builds the Dock with your own Samsung certificate and installs it over your network. Samsung requires this one-off setup for any custom TV app.');
    var box = h('div');
    view.appendChild(box);
    function help(id, pre) {
      var steps = {
        sdk: ['Install Visual Studio Code from code.visualstudio.com.', 'In Extensions, search “Tizen TV” (publisher samsungtvsdk) and install it.', 'Let it install the Tizen SDK (“Install new Tizen SDK”), then Tizen sidebar > Packages > Advanced: install the latest TV extension.', 'Come back here and press Check again (or choose the SDK folder yourself).'],
        cert: ['Nothing to do for 2018 to 2022 TVs: Dock TV creates a free Tizen developer certificate called DockTizen for you (no Samsung account).', 'If your TV is newer and refuses it, create a Samsung certificate in VS Code instead: Tizen sidebar > Actions > Create Certificate, with this TV’s DUID' + (pre.duid ? ' (' + pre.duid + ')' : '') + ' ticked, then press Install again.'],
        tv: ['Switch the TV fully on (not standby), on the same router as this PC.', 'Go back to step 1 and find the TV again if its IP changed.'],
        dev: ['On the TV press Home, open APPS.', 'Press 1 2 3 4 5 on the remote (Smart Remote: use the 123 button).', 'Turn Developer mode On and enter this PC’s IP: ' + (pre.pcIp || '?') + '.', 'Choose OK, then hold the power button for 5+ seconds until the TV restarts.'],
      };
      return h('ol', { class: 'help' }, (steps[id] || []).map(function (s) { return h('li', null, s); }));
    }
    function draw() {
      clear(box);
      var btn = h('button', { class: 'btn' }, 'Checking…');
      box.appendChild(h('div', { class: 'card' }, h('div', { class: 'row' }, btn)));
      api.install.preflight().then(function (pre) {
        clear(box);
        if (pre.compat && pre.compat.level !== 'verified') box.appendChild(h('div', { class: 'note' }, pre.compat.text));
        var card = h('div', { class: 'card' }, h('h2', null, 'Before installing'));
        var shown = {};
        pre.checks.forEach(function (c) {
          card.appendChild(h('div', { class: 'check' }, h('span', { class: 'dot' + (c.ok ? '' : ' no') }),
            h('div', { class: 'grow' }, h('b', null, c.label), h('div', { class: 'small muted' }, c.detail),
              !c.ok && !shown[c.help] ? (shown[c.help] = 1, help(c.help, pre)) : null)));
        });
        var row = h('div', { class: 'row', style: 'margin-top:12px' });
        var again = h('button', { class: 'btn', onclick: draw }, 'Check again');
        var pickSdk = h('button', { class: 'btn', onclick: function () { api.install.pickSdk().then(function (p) { if (p) draw(); }).catch(fail); } }, 'Choose SDK folder…');
        var vs = link('Get VS Code', 'https://code.visualstudio.com');
        row.appendChild(again); row.appendChild(pickSdk); row.appendChild(vs);
        card.appendChild(row);
        box.appendChild(card);

        var log = h('div', { class: 'log', hidden: true });
        var inst = h('button', { class: 'btn primary', disabled: !pre.ready }, 'Install on my TV');
        inst.onclick = function () {
          log.hidden = false; log.textContent = '';
          var off = api.on('install:log', function (line) { log.textContent += line + '\n'; log.scrollTop = log.scrollHeight; });
          busy(inst, 'Installing…', function () {
            return api.install.run({}).then(function (r) {
              log.textContent += r.launched ? '\nDone.\n' : '\nDone. Open Dock from Home > APPS.\n';
              box.appendChild(h('div', { class: 'note ok' }, 'Installed. Pin it: Home > APPS > highlight Dock > Add to Home, and move it first. Then turn Developer Mode off again (APPS > 1 2 3 4 5 > Off, restart).'));
            }).catch(function (e) { log.textContent += '\n' + String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') + '\n'; });
          }).then(off);
        };
        box.appendChild(h('div', { class: 'row' }, inst, h('span', { class: 'muted small' }, pre.ready ? 'Ready.' : 'Fix the red items first.')));
        box.appendChild(log);
      }).catch(fail);
    }
    draw();
  }

  // ---------- 6. restore ----------
  function viewRestore() {
    header('Restore your TV', 'Undo every change, newest first. Restoring is safe to repeat: finished items are skipped.');
    var box = h('div');
    view.appendChild(box);
    function draw() {
      clear(box);
      api.restore.list().then(function (r) {
        if (!r.entries.length) box.appendChild(h('div', { class: 'note ok' }, 'No logged setting changes left to undo.'));
        r.entries.forEach(function (e) {
          var what;
          if (e.id === 'homebar') what = ['Add these tiles back: Home > APPS > highlight the app > Add to Home.'].concat((e.tiles || []).map(function (t) { return '• ' + t; }));
          else if (e.id === 'terms-extra') what = ['Switch these back on:'].concat((e.items || []).map(function (t) { return '• ' + t; }));
          else if (e.id === 'dns') what = ['Set DNS back to: ' + e.before];
          else what = ['Set it back to ' + e.before + ' (it is ' + e.after + ' now).'];
          box.appendChild(h('div', { class: 'card' }, h('h2', null, e.name), h('p', { class: 'small' }, 'Where: ', h('code', null, e.path)),
            h('div', { style: 'margin:8px 0;color:var(--muted)' }, what.map(function (l) { return h('div', null, l); })),
            h('button', { class: 'btn sm primary', onclick: function () { api.restore.done(e.id).then(draw); } }, 'Done on the TV')));
        });
        if (r.installed) {
          var u = h('button', { class: 'btn primary' }, 'Uninstall Dock from the TV');
          u.onclick = function () { busy(u, 'Working…', function () { return api.restore.uninstall().then(function (ok) {
            if (ok) { toast('Dock uninstalled.'); draw(); } else toast('Could not uninstall over the network. Delete it on the TV: Home > APPS > Settings > Dock > Delete.', true); }); }); };
          box.appendChild(h('div', { class: 'card' }, h('h2', null, 'Dock launcher'), h('p', { class: 'small' }, 'The only app Dock TV installs.'),
            h('div', { class: 'row', style: 'margin-top:8px' }, u, h('button', { class: 'btn', onclick: function () { api.restore.uninstall({ manual: true }).then(draw); } }, 'I deleted it on the TV'))));
        }
        box.appendChild(h('div', { class: 'card' }, h('h2', null, 'Developer Mode'), h('p', { class: 'small' }, 'Turn it off when you are finished: Home > APPS > press 1 2 3 4 5 > Developer mode Off > OK, then hold power for 5+ seconds to restart.')));
      }).catch(fail);
    }
    draw();
  }

  // ---------- start ----------
  document.getElementById('openData').onclick = function () { api.open.folder(); };
  api.appInfo().then(function (i) { document.getElementById('ver').textContent = 'v' + i.version; });
  go('connect');
})();
