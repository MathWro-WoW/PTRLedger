const DATA_URL = './data/patches.json';
const state = {
  data: null,
  patch: null,
  classId: 'all',
  spec: 'all',
  direction: 'all',
  round: 'all',
  query: '',
  revisedOnly: false,
  openClassMenu: null,
  menuCloseScrollY: null,
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  patchSelect: $('#patch-select'),
  classNav: $('#class-nav'),
  roundFilter: $('#round-filter'),
  directionFilter: $('#direction-filter'),
  search: $('#search'),
  revisedOnly: $('#revised-only'),
  list: $('#change-list'),
  empty: $('#empty-state'),
  roundList: $('#round-list'),
};

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) element.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child) element.append(child);
  }
  return element;
}

function formatDate(value, long = false) {
  if (!value) return 'Unknown';
  return new Intl.DateTimeFormat('en', long
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { day: '2-digit', month: 'short', year: 'numeric' }
  ).format(new Date(value));
}

function highlightedText(text) {
  const fragment = document.createDocumentFragment();
  const expression = /(\b\d+(?:\.\d+)?%?(?:\s*\/\s*\d+(?:\.\d+)?%?)?(?:\s+(?:additional\s+)?(?:seconds?|minutes?|yards?|targets?|charges?|stacks?|times?|points?|Fury|Rage|Energy|Focus|Holy Power|Astral Power|Insanity|Icicles?|orbs?|uses?|enemies?|allies?|casts?|Ghouls?))?\b)/gi;
  let cursor = 0;
  for (const match of text.matchAll(expression)) {
    fragment.append(document.createTextNode(text.slice(cursor, match.index)));
    fragment.append(node('span', { className: 'number', text: match[0] }));
    cursor = match.index + match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(cursor)));
  return fragment;
}

function allChanges() {
  return state.patch.classes.flatMap((classInfo) => classInfo.changes.map((change) => ({ ...change, classInfo })));
}

function selectedClass() {
  return state.patch.classes.find((classInfo) => classInfo.id === state.classId) || null;
}

const NON_SPECIALIZATIONS = new Set(['Class-wide', 'General']);

function specializationsForChanges(changes) {
  return [...new Set(changes.map((change) => change.spec))]
    .filter((spec) => !NON_SPECIALIZATIONS.has(spec))
    .sort((a, b) => a.localeCompare(b));
}

function visibleChanges() {
  const query = state.query.toLocaleLowerCase();
  return allChanges().map(({ classInfo, ...change }) => {
    if (state.round === 'all') return { ...change, classInfo };
    const checkpoint = change.history.find((item) => String(item.round) === state.round);
    if (!checkpoint) return null;
    return {
      ...change,
      text: checkpoint.text,
      value: checkpoint.effectiveValue || checkpoint.value,
      latestAdjustment: checkpoint.value,
      baseline: checkpoint.baseline,
      direction: checkpoint.direction,
      classInfo,
    };
  }).filter((change) => {
    if (!change) return false;
    if (state.classId !== 'all' && change.classInfo.id !== state.classId) return false;
    if (state.spec !== 'all' && change.spec !== state.spec) return false;
    if (state.direction !== 'all' && change.direction !== state.direction) return false;
    if (state.revisedOnly && change.history.length < 2) return false;
    if (query) {
      const haystack = [change.classInfo.name, change.spec, change.category, change.subject, change.text]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function updateUrl() {
  const params = new URLSearchParams(location.search);
  params.set('patch', state.patch.id);
  history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`);
}

function renderPatchMeta() {
  $('#patch-ghost').textContent = state.patch.id;
  $('#patch-status').textContent = `${state.patch.status} snapshot · ${state.patch.rounds.length} rounds consolidated`;
  $('#stat-classes').textContent = state.patch.stats.classes;
  $('#stat-changes').textContent = state.patch.stats.changes.toLocaleString();
  $('#stat-revised').textContent = state.patch.stats.revised.toLocaleString();
  $('#stat-date').textContent = formatDate(state.patch.lastUpdated, true);
  $('#class-count').textContent = `${state.patch.stats.classes}`;
  for (const selector of ['#header-source', '#footer-source']) $(selector).href = state.patch.source;
}

function renderClassNav() {
  const total = state.patch.stats.changes;
  const options = [
    { id: 'all', name: 'Every class', mark: 'ALL', color: '#73b7ff', icon: './assets/classes/everyclass.svg', changes: Array(total) },
    ...state.patch.classes,
  ];

  const scrollLeft = elements.classNav.scrollLeft;
  elements.classNav.replaceChildren(...options.map((classInfo) => {
    const icon = classInfo.icon || (classInfo.id === 'all-classes' ? './assets/classes/allclasses.svg' : null);
    const mark = node('span', { className: `class-mark${icon ? ' has-icon' : ''}` });
    if (icon) {
      mark.append(node('img', {
        attrs: { src: icon, alt: '', width: '30', height: '30' },
      }));
    } else {
      mark.textContent = classInfo.mark;
      mark.style.setProperty('--class-color', classInfo.color);
    }

    const specs = classInfo.id === 'all' ? [] : specializationsForChanges(classInfo.changes);
    const isOpen = state.openClassMenu === classInfo.id && specs.length > 0;
    const submenuId = `class-submenu-${classInfo.id}`;
    const tail = node('span', { className: 'class-tail' }, [
      node('span', { className: 'count', text: classInfo.id === 'all' ? total : classInfo.changes.length }),
      ...(specs.length ? [node('span', { className: 'class-expand', text: '›', attrs: { 'aria-hidden': 'true' } })] : []),
    ]);
    const buttonAttrs = {
      type: 'button',
      'data-class': classInfo.id,
      'aria-pressed': String(state.classId === classInfo.id),
    };
    if (specs.length) {
      buttonAttrs['aria-expanded'] = String(isOpen);
      buttonAttrs['aria-controls'] = submenuId;
    }
    const button = node('button', {
      className: `class-button${state.classId === classInfo.id ? ' is-active' : ''}${isOpen ? ' is-expanded' : ''}`,
      attrs: buttonAttrs,
    }, [mark, node('span', { text: classInfo.name }), tail]);

    const item = node('div', { className: 'class-nav-item' }, button);
    if (isOpen) {
      item.append(node('div', {
        className: 'class-submenu',
        attrs: { id: submenuId, 'aria-label': `${classInfo.name} specializations` },
      }, [
        node('button', {
          className: `class-spec-button${state.spec === 'all' ? ' is-active' : ''}`,
          text: 'All specializations',
          attrs: { type: 'button', 'data-class-spec': 'all', 'aria-pressed': String(state.spec === 'all') },
        }),
        ...specs.map((spec) => node('button', {
          className: `class-spec-button${state.spec === spec ? ' is-active' : ''}`,
          text: spec,
          attrs: { type: 'button', 'data-class-spec': spec, 'aria-pressed': String(state.spec === spec) },
        })),
      ]));
    }
    return item;
  }));
  elements.classNav.scrollLeft = scrollLeft;
}

function renderRoundOptions() {
  elements.roundFilter.replaceChildren(
    node('option', { text: 'All rounds · latest effective values', attrs: { value: 'all' } }),
    ...state.patch.rounds.map((round) => node('option', {
      text: `${round.label} · ${formatDate(round.date)}`,
      attrs: { value: round.number },
    })),
  );
  elements.roundFilter.value = state.round;
}

function timeline(change) {
  const items = change.history.map((item) => {
    const checkpointMath = item.effectiveValue
      ? node('p', { className: 'timeline-result' }, [
          node('span', { text: 'Result vs live' }),
          node('strong', { text: item.effectiveValue }),
        ])
      : null;
    const copy = node('div', { className: 'timeline-copy' }, [
      node('p', { text: item.text }),
      checkpointMath,
      node('a', {
        text: 'Official note ↗',
        attrs: { href: item.source, target: '_blank', rel: 'noreferrer' },
      }),
    ]);
    return node('div', { className: 'timeline-item' }, [
      node('time', { className: 'timeline-date', text: formatDate(item.date), attrs: { datetime: item.date } }),
      copy,
    ]);
  });
  return node('div', { className: 'timeline' }, items);
}

function changeCard(change) {
  const directionLabels = { buff: 'Buff', nerf: 'Nerf', changed: 'Changed' };
  const metadata = [node('span', { className: 'direction-label', text: directionLabels[change.direction] })];
  if (state.classId === 'all' && !NON_SPECIALIZATIONS.has(change.spec)) {
    metadata.push(node('span', { className: 'category-label', text: `· ${change.spec}` }));
  }
  if (change.category) metadata.push(node('span', { className: 'category-label', text: `· ${change.category}` }));

  const name = node('div', { className: 'change-name' }, [
    node('div', { className: 'change-meta' }, metadata),
    node('h3', { text: change.subject }),
  ]);

  const hasNumericComparison = /\d/.test(change.value);
  let comparison = null;
  if (hasNumericComparison) {
    const ptr = node('div', { className: 'value-block ptr' }, [
      node('small', {
        text: change.cumulative
          ? 'Cumulative vs live'
          : change.baseline ? state.patch.status : `${state.patch.status} change`,
      }),
      node('b', { text: change.value }),
    ]);
    const values = change.baseline
      ? [
          node('div', { className: 'value-block' }, [
            node('small', { text: 'Live' }),
            node('b', { text: change.baseline }),
          ]),
          node('span', { className: 'comparison-arrow', text: '→', attrs: { 'aria-hidden': 'true' } }),
          ptr,
        ]
      : [ptr];
    comparison = node('div', { className: `comparison${change.baseline ? '' : ' is-single'}` }, values);
  }
  const note = node('p', { className: 'current-note' });
  note.append(highlightedText(change.text));
  const cumulativeNote = change.cumulative
    ? node('p', {
        className: 'cumulative-note',
        text: state.round === 'all'
          ? `Includes all adjustments shown below.${change.subject === 'Overall damage' ? ' Targeted changes are tracked separately.' : ''}`
          : 'Includes adjustments made up to this update.',
      })
    : null;
  const content = node('div', {}, [comparison, note, cumulativeNote]);

  let footer;
  if (change.history.length > 1) {
    const details = node('details', { className: 'history-disclosure' }, [
      node('summary', {}, [
        node('span', { text: `Revision trail · ${change.history.length} checkpoints` }),
        node('span', { text: '+', attrs: { 'aria-hidden': 'true' } }),
      ]),
      timeline(change),
    ]);
    footer = node('div', { className: 'card-footer' }, details);
  } else {
    const source = change.history[0]?.source || state.patch.source;
    footer = node('div', { className: 'card-footer source-only' }, node('a', {
      text: 'Official note ↗',
      attrs: { href: source, target: '_blank', rel: 'noreferrer' },
    }));
  }

  return node('article', {
    className: 'change-card',
    attrs: { 'data-direction': change.direction, 'data-value-kind': hasNumericComparison ? 'numeric' : 'qualitative' },
  }, [node('div', { className: 'card-main' }, [name, content]), footer]);
}

function renderChanges() {
  const visible = visibleChanges();
  const classInfo = selectedClass();
  const selectedName = classInfo?.name || 'Every class';
  $('#result-kicker').textContent = state.spec === 'all' ? selectedName : `${selectedName} · ${state.spec}`;
  const selectedRound = state.patch.rounds.find((round) => String(round.number) === state.round);
  $('#result-title').textContent = selectedRound
    ? `${selectedRound.label}${state.revisedOnly ? ' · revised changes' : ' changes'}`
    : state.revisedOnly ? 'Revised effective changes' : 'Latest effective changes';
  $('#result-count').textContent = `${visible.length.toLocaleString()} ${visible.length === 1 ? 'change' : 'changes'}`;

  const groups = new Map();
  for (const change of visible) {
    const group = state.classId === 'all' ? change.classInfo.name : change.spec;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(change);
  }

  const sections = [...groups]
    .sort(([left], [right]) => {
      if (left === 'Class-wide') return -1;
      if (right === 'Class-wide') return 1;
      return left.localeCompare(right, 'en');
    })
    .map(([name, changes]) => node('section', {
      className: 'spec-section',
      attrs: { style: `--section-color: ${changes[0].classInfo.color}` },
    }, [
      node('h2', { className: 'spec-heading' }, [
        node('span', { className: 'spec-name', text: name }),
        node('span', {
          className: 'spec-count',
          text: `${changes.length.toLocaleString()} ${changes.length === 1 ? 'change' : 'changes'}`,
        }),
      ]),
      ...changes.map(changeCard),
    ]));

  elements.list.replaceChildren(...sections);
  elements.empty.hidden = visible.length > 0;
  armClassMenuDismissal();
}

function renderRounds() {
  elements.roundList.replaceChildren(...state.patch.rounds.map((round) => node('li', { className: 'round-item' }, [
    node('span', { className: 'round-pip', attrs: { 'aria-hidden': 'true' } }),
    node('div', {}, [
      node('a', { text: `${round.label} · ${round.changes} changes`, attrs: { href: round.source, target: '_blank', rel: 'noreferrer' } }),
      node('time', { text: formatDate(round.date), attrs: { datetime: round.date } }),
    ]),
  ])));
}

function renderAll() {
  renderPatchMeta();
  renderClassNav();
  renderRoundOptions();
  renderChanges();
  renderRounds();
  updateUrl();
}

function selectPatch(id) {
  state.patch = state.data.patches.find((patch) => patch.id === id)
    || state.data.patches.find((patch) => patch.current)
    || state.data.patches[0];
  state.classId = 'all';
  state.spec = 'all';
  state.round = 'all';
  state.openClassMenu = null;
  state.menuCloseScrollY = null;
  elements.patchSelect.value = state.patch.id;
  renderAll();
}

function resetFilters() {
  state.classId = 'all';
  state.spec = 'all';
  state.direction = 'all';
  state.query = '';
  state.revisedOnly = false;
  state.round = 'all';
  state.openClassMenu = null;
  state.menuCloseScrollY = null;
  elements.search.value = '';
  elements.revisedOnly.checked = false;
  elements.roundFilter.value = 'all';
  elements.directionFilter.querySelectorAll('button').forEach((button) => {
    const isActive = button.dataset.direction === 'all';
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  renderClassNav();
  renderRoundOptions();
  renderChanges();
}

let menuScrollFrame = null;

function armClassMenuDismissal() {
  if (!state.openClassMenu) {
    state.menuCloseScrollY = null;
    return;
  }
  requestAnimationFrame(() => {
    if (!state.openClassMenu) return;
    const listBottom = window.scrollY + elements.list.getBoundingClientRect().bottom;
    state.menuCloseScrollY = Math.max(
      window.scrollY + 160,
      listBottom - window.innerHeight + 24,
    );
  });
}

function dismissClassMenuAfterSection() {
  if (menuScrollFrame || !state.openClassMenu || state.menuCloseScrollY === null) return;
  menuScrollFrame = requestAnimationFrame(() => {
    menuScrollFrame = null;
    if (window.scrollY < state.menuCloseScrollY) return;
    state.openClassMenu = null;
    state.menuCloseScrollY = null;
    renderClassNav();
  });
}

function scrollToResultsTop() {
  const ledger = $('#changes');
  const headerHeight = $('.site-header')?.getBoundingClientRect().height || 0;
  const top = window.scrollY + ledger.getBoundingClientRect().top - headerHeight;
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  window.scrollTo({ top: Math.max(0, top), behavior });
}

function bindEvents() {
  elements.patchSelect.addEventListener('change', (event) => selectPatch(event.target.value));
  elements.classNav.addEventListener('click', (event) => {
    const specButton = event.target.closest('[data-class-spec]');
    if (specButton) {
      state.spec = specButton.dataset.classSpec;
      renderClassNav();
      renderChanges();
      scrollToResultsTop();
      return;
    }

    const button = event.target.closest('[data-class]');
    if (!button) return;
    state.classId = button.dataset.class;
    state.spec = 'all';
    state.openClassMenu = specializationsForChanges(selectedClass()?.changes || []).length
      ? state.classId
      : null;
    renderClassNav();
    renderChanges();
    scrollToResultsTop();
  });
  elements.roundFilter.addEventListener('change', (event) => {
    state.round = event.target.value;
    renderChanges();
  });
  elements.directionFilter.addEventListener('click', (event) => {
    const button = event.target.closest('[data-direction]');
    if (!button) return;
    state.direction = button.dataset.direction;
    elements.directionFilter.querySelectorAll('button').forEach((item) => {
      const isActive = item === button;
      item.classList.toggle('is-active', isActive);
      item.setAttribute('aria-pressed', String(isActive));
    });
    renderChanges();
  });
  elements.search.addEventListener('input', (event) => {
    state.query = event.target.value.trim();
    renderChanges();
  });
  elements.revisedOnly.addEventListener('change', (event) => {
    state.revisedOnly = event.target.checked;
    renderChanges();
  });
  $('#clear-filters').addEventListener('click', resetFilters);
  window.addEventListener('scroll', dismissClassMenuAfterSection, { passive: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      event.preventDefault();
      elements.search.focus();
    }
  });
}

async function start() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`Data request failed (${response.status})`);
    state.data = await response.json();
    if (!state.data.patches?.length) throw new Error('No patches are configured');

    elements.patchSelect.replaceChildren(...state.data.patches.map((patch) => node('option', {
      text: patch.label,
      attrs: { value: patch.id },
    })));
    bindEvents();
    const requested = new URLSearchParams(location.search).get('patch');
    selectPatch(requested);
  } catch (error) {
    console.error(error);
    elements.list.replaceChildren(node('div', { className: 'empty-state' }, [
      node('span', { text: '!' }),
      node('h2', { text: 'The ledger could not be opened.' }),
      node('p', { text: 'The generated patch data is missing or invalid.' }),
    ]));
  } finally {
    requestAnimationFrame(() => $('#loading-screen').classList.add('is-hidden'));
  }
}

start();
