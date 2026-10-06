/* Учёт заходов команды на страницы сайта — для вкладки «Активность» в Avito Tasks.
 * Подключается на рабочих страницах (база знаний, дашборд, стажировка и другие инструменты команды).
 * Срабатывает, только если в этом браузере выполнен вход в трекер (cantor.agency/avito-tasks):
 * отмечает заход на страницу и 10-минутные отрезки, в которые человек что-то делал на ней
 * (клик, прокрутка, ввод — пока вкладка открыта на экране). Остальным посетителям ничего не отправляет.
 * Данные уходят в воркер через функцию Яндекс Облака (как у трекера — работает без VPN). */
(function () {
  'use strict';
  var token = null;
  try { token = localStorage.getItem('avitoTasks.token'); } catch (e) { /* хранилище недоступно */ }
  if (!token || !window.fetch) return;

  var PATH = '/api/dashboard/avito-tasks/visit';
  var PROXY = 'https://functions.yandexcloud.net/d4eiu56ijlg0jn5o9rch?p=' + encodeURIComponent(PATH);
  var DIRECT = 'https://mainweb.oxion-ezhkov.workers.dev' + PATH;
  var host = location.hostname;
  var routes = host === 'localhost' || host === '127.0.0.1' ? [location.origin + PATH]
    : /workers\.dev$/.test(host) ? [location.origin + PATH, PROXY] : [PROXY, DIRECT];
  var MSK = 3 * 3600000;
  var pending = {};
  var opened = true;
  var lastMark = 0;
  var lastSent = 0;

  function mark() {
    if (document.hidden) return;
    var now = Date.now();
    if (now - lastMark < 15000) return;
    lastMark = now;
    var d = new Date(now + MSK);
    var date = d.toISOString().slice(0, 10);
    var slot = Math.floor((d.getUTCHours() * 60 + d.getUTCMinutes()) / 10);
    var list = pending[date] || (pending[date] = []);
    if (list.indexOf(slot) === -1) list.push(slot);
  }
  function payload() {
    return JSON.stringify({ token: token, page: { path: location.pathname, title: document.title }, opened: opened, slots: pending });
  }
  // Убираем только то, что ушло: отрезки, отмеченные во время отправки, остаются до следующей.
  function sent(done) {
    opened = false;
    lastSent = Date.now();
    Object.keys(done).forEach(function (date) {
      var left = (pending[date] || []).filter(function (x) { return done[date].indexOf(x) === -1; });
      if (left.length) pending[date] = left; else delete pending[date];
    });
  }
  function copy() { return JSON.parse(JSON.stringify(pending)); }
  function hasPending() { return opened || Object.keys(pending).length > 0; }

  function send(i) {
    i = i || 0;
    if (!hasPending() || i >= routes.length) return;
    var body = payload();
    var snapshot = copy();
    fetch(routes[i], { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: true })
      .then(function (res) {
        if (res.status === 502 || res.status === 504) return send(i + 1);
        // 401/403 — вход в трекер устарел: дальше не шлём.
        if (res.status === 401 || res.status === 403) { token = null; pending = {}; opened = false; return; }
        if (res.ok) sent(snapshot);
      })
      .catch(function () { send(i + 1); });
  }
  // При уходе со страницы — то, что не успело уйти, отправляем маячком.
  function flush() {
    if (!token || !hasPending() || !navigator.sendBeacon) return;
    var snapshot = copy();
    if (navigator.sendBeacon(routes[0], new Blob([payload()], { type: 'text/plain' }))) sent(snapshot);
  }

  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel', 'mousemove'].forEach(function (ev) {
    window.addEventListener(ev, mark, { passive: true, capture: true });
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); else mark(); });
  window.addEventListener('pagehide', flush);
  mark();
  send();
  setInterval(function () { if (token && !document.hidden && Date.now() - lastSent > 4 * 60000) send(); }, 60000);
})();
