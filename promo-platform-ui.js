(() => {
  'use strict';

  const tabs = [...document.querySelectorAll('.feature-tab')];
  function activateTab(active) {
    for (const tab of tabs) {
      const selected = tab === active;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    }
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', event => {
      const targets = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index - 1 + tabs.length) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      };
      if (!(event.key in targets)) return;
      event.preventDefault();
      const target = tabs[targets[event.key]];
      activateTab(target);
      target.focus();
    });
  });

  const slider = document.getElementById('budget');
  function paintBudget() {
    const percentage = (Number(slider.value) - Number(slider.min)) /
      (Number(slider.max) - Number(slider.min)) * 100;
    slider.style.setProperty('--fill', `${percentage}%`);
    slider.setAttribute('aria-valuetext', `${Number(slider.value).toLocaleString('ru-RU')} рублей в месяц`);
  }
  slider.addEventListener('input', paintBudget);
  paintBudget();

  // Enhance the real selects, preserving submitted values and native fallback.
  const closePickers = [];
  document.querySelectorAll('#access-form select').forEach((select, index) => {
    const label = select.closest('label');
    const name = label.firstChild.textContent.trim();
    const field = document.createElement('div');
    field.className = label.className;
    while (label.firstChild) field.append(label.firstChild);
    label.replaceWith(field);
    select.setAttribute('aria-label', name);

    const wrap = document.createElement('div');
    wrap.className = 'agency-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'select-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-label', name);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `choices-${index}`);
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.textContent = select.selectedOptions[0].textContent;

    const list = document.createElement('div');
    list.id = `choices-${index}`;
    list.className = 'select-options';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', name);
    list.hidden = true;

    function close() {
      list.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
    function open() {
      closePickers.forEach(closePicker => closePicker());
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
    }
    const choices = [...select.options].map(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.className = 'select-option';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(option.selected));
      button.textContent = option.value ? option.textContent : 'Не указывать';
      button.addEventListener('click', event => {
        event.preventDefault();
        select.value = option.value;
        trigger.textContent = option.value ? option.textContent : 'Выберите';
        trigger.classList.remove('invalid');
        choices.forEach(choice => choice.setAttribute('aria-selected', String(choice === button)));
        close();
        trigger.focus();
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      list.append(button);
      return button;
    });
    trigger.addEventListener('click', event => {
      event.preventDefault();
      if (list.hidden) open(); else close();
    });
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Escape') { close(); return; }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      open();
      const selected = select.selectedIndex;
      choices[event.key === 'ArrowUp' ? choices.length - 1 : Math.max(0, selected)].focus();
    });
    list.addEventListener('keydown', event => {
      const current = choices.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        trigger.focus();
        return;
      }
      const targets = {
        ArrowDown: (current + 1) % choices.length,
        ArrowUp: (current - 1 + choices.length) % choices.length,
        Home: 0,
        End: choices.length - 1,
      };
      if (!(event.key in targets)) return;
      event.preventDefault();
      choices[targets[event.key]].focus();
    });
    wrap.addEventListener('focusout', event => {
      // During native pointer focus changes activeElement can temporarily be body.
      // relatedTarget is the destination; an option inside this picker must stay open.
      if (event.relatedTarget && wrap.contains(event.relatedTarget)) return;
      close();
    });
    document.addEventListener('click', event => {
      if (!wrap.contains(event.target)) close();
    });
    select.classList.add('select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.addEventListener('invalid', event => {
      event.preventDefault();
      trigger.classList.add('invalid');
      trigger.focus();
    });
    wrap.append(trigger, list);
    select.after(wrap);
    closePickers.push(close);
  });

  const header = document.querySelector('.site-header');
  const hero = document.querySelector('.hero');
  let scheduled = false;
  function syncHeader() {
    scheduled = false;
    const anchorOffset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const revealAt = Math.max(anchorOffset, header.offsetHeight) + 2;
    const visible = hero.getBoundingClientRect().bottom <= revealAt;
    header.classList.toggle('is-visible', visible);
    header.inert = !visible;
    header.setAttribute('aria-hidden', String(!visible));
  }
  function scheduleHeader() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(syncHeader);
  }
  addEventListener('scroll', scheduleHeader, { passive: true });
  addEventListener('resize', scheduleHeader);
  addEventListener('pageshow', syncHeader);
  syncHeader();

  // Animate compact blocks once; never hide content before JavaScript runs.
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08 });
    document.querySelectorAll('.pain,.journey,.feature-heading,.panel-art,.compare-cards article,.support-features article,.audience,.big-stats,.case,.values>div,details').forEach(element => {
      element.classList.add('reveal-ready');
      observer.observe(element);
    });
  }
})();
