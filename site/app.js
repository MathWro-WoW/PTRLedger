const DATA_URL = './data/patches.json';
const WOWHEAD_TOOLTIP_URL = 'https://nether.wowhead.com';
const TOOLTIP_DISCLAIMER = 'Fetched on demand from Wowhead. PTR tooltip data may lag behind Blizzard’s latest PTR notes; the official-note history remains authoritative.';
const tooltipCache = new Map();
const tooltipView = {
  element: null,
  activeTrigger: null,
  request: null,
  closeTimer: null,
  pinned: false,
};
const state = {
  data: null,
  patch: null,
  classId: 'all',
  spec: 'all',
  direction: 'all',
  round: 'all',
  query: '',
  talentsOnly: false,
  revisedOnly: false,
  hidePvpExcluded: false,
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
  talentsOnly: $('#talents-only'),
  revisedOnly: $('#revised-only'),
  pvpFilter: $('#pvp-filter'),
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
const TOOLTIP_TAGS = new Set(['B', 'BR', 'DIV', 'EM', 'SMALL', 'SPAN', 'STRONG', 'TABLE', 'TBODY', 'TD', 'TH', 'TR']);
const TOOLTIP_CLASSES = new Set(['q', 'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'whtt-name', 'wowhead-tooltip-requirements']);

function sanitizedTooltip(html) {
  const template = document.createElement('template');
  template.innerHTML = html;

  for (let element of [...template.content.querySelectorAll('*')]) {
    if (element.tagName === 'A') {
      const replacement = document.createElement('span');
      replacement.replaceChildren(...element.childNodes);
      element.replaceWith(replacement);
      element = replacement;
    } else if (!TOOLTIP_TAGS.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }

    const classes = [...element.classList].filter((className) => TOOLTIP_CLASSES.has(className));
    const color = /^#[0-9a-f]{6}$/i.test(element.style.color) ? element.style.color : '';
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    if (classes.length) element.className = classes.join(' ');
    if (color) element.style.color = color;
  }

  const comments = document.createTreeWalker(template.content, NodeFilter.SHOW_COMMENT);
  const removable = [];
  while (comments.nextNode()) removable.push(comments.currentNode);
  for (const comment of removable) comment.remove();

  return node('div', { className: 'wowhead-tooltip-body' }, [template.content]);
}

function requestWowheadTooltip(spellId, environment) {
  const key = `${environment}:${spellId}`;
  if (tooltipCache.has(key)) return tooltipCache.get(key);

  const domain = environment === 'ptr' ? '/ptr' : '';
  const request = fetch(`${WOWHEAD_TOOLTIP_URL}${domain}/tooltip/spell/${spellId}?locale=0`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Tooltip request failed (${response.status})`);
      const payload = await response.json();
      if (!payload.tooltip) throw new Error('Tooltip is not available');
      return { ok: true, payload };
    })
    .catch((error) => {
      tooltipCache.delete(key);
      return { ok: false, error };
    });
  tooltipCache.set(key, request);
  return request;
}

function ensureTooltipView() {
  if (tooltipView.element) return tooltipView.element;

  const tooltip = node('aside', {
    className: 'ability-tooltip',
    attrs: {
      id: 'ability-tooltip',
      role: 'dialog',
      'aria-label': 'Live and PTR ability tooltips',
      'aria-live': 'polite',
    },
  });
  tooltip.hidden = true;
  tooltip.addEventListener('pointerenter', cancelTooltipClose);
  tooltip.addEventListener('pointerleave', scheduleTooltipClose);
  tooltip.addEventListener('focusin', cancelTooltipClose);
  tooltip.addEventListener('focusout', scheduleTooltipClose);
  document.body.append(tooltip);
  tooltipView.element = tooltip;
  return tooltip;
}

function tooltipAnchor(target) {
  return target instanceof Element
    ? target.closest('.change-name[data-tooltip-spell]')
    : null;
}

function setTooltipExpanded(trigger, expanded) {
  trigger?.querySelector('.ability-name-trigger')
    ?.setAttribute('aria-expanded', String(expanded));
}

function tooltipHeader(abilityName, statusText = 'Loading tooltip data…') {
  return node('header', { className: 'ability-tooltip-header' }, [
    node('div', {}, [
      node('span', { className: 'ability-tooltip-kicker', text: 'Ability context' }),
      node('strong', { text: abilityName }),
    ]),
    node('div', { className: 'ability-tooltip-actions' }, [
      node('span', { className: 'ability-tooltip-status', text: statusText }),
      node('button', {
        className: 'ability-tooltip-close',
        text: 'Close',
        attrs: { type: 'button', 'data-tooltip-close': '', 'aria-label': 'Close tooltip comparison' },
      }),
    ]),
  ]);
}

function wowheadSourceLink(label, spellId, environment) {
  const domain = environment === 'ptr' ? '/ptr' : '';
  return node('a', {
    className: 'ability-tooltip-source',
    text: 'Wowhead ↗',
    attrs: {
      href: `https://www.wowhead.com${domain}/spell=${spellId}`,
      target: '_blank',
      rel: 'noreferrer',
      'aria-label': `Open the ${label} spell page on Wowhead`,
    },
  });
}

function loadingTooltipPane(label, spellId, environment) {
  return node('section', { className: 'ability-tooltip-pane is-loading' }, [
    node('div', { className: 'ability-tooltip-environment' }, [
      node('span', { text: label }),
      wowheadSourceLink(label, spellId, environment),
    ]),
    node('div', { className: 'ability-tooltip-loading', text: 'Retrieving tooltip…' }),
  ]);
}

function loadedTooltipPane(label, result, spellId, environment) {
  if (!result.ok) {
    return {
      element: node('section', { className: 'ability-tooltip-pane is-unavailable' }, [
        node('div', { className: 'ability-tooltip-environment' }, [
          node('span', { text: label }),
          node('span', { className: 'ability-tooltip-source', text: 'Unavailable' }),
        ]),
        node('div', { className: 'ability-tooltip-unavailable' }, [
          node('strong', { text: 'No tooltip available' }),
          node('p', { text: 'Wowhead has not indexed this spell in this environment, or the request could not be completed.' }),
        ]),
      ]),
      text: null,
    };
  }

  const content = sanitizedTooltip(result.payload.tooltip);
  return {
    element: node('section', { className: 'ability-tooltip-pane' }, [
      node('div', { className: 'ability-tooltip-environment' }, [
        node('span', { text: label }),
        wowheadSourceLink(label, spellId, environment),
      ]),
      content,
    ]),
    text: content.textContent.replace(/\s+/g, ' ').trim(),
  };
}

function positionAbilityTooltip() {
  const tooltip = tooltipView.element;
  const trigger = tooltipView.activeTrigger;
  if (!tooltip || tooltip.hidden || !trigger?.isConnected) return;

  const margin = 12;
  const gap = 10;
  const triggerRect = trigger.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const idealLeft = triggerRect.left + Math.min(triggerRect.width * 0.18, 32);
  const left = Math.max(margin, Math.min(idealLeft, window.innerWidth - tooltipRect.width - margin));
  const below = triggerRect.bottom + gap;
  const top = below + tooltipRect.height <= window.innerHeight - margin
    ? below
    : Math.max(margin, triggerRect.top - tooltipRect.height - gap);
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

async function showAbilityTooltip(trigger, pinned = false) {
  if (!trigger?.dataset.tooltipSpell) return;
  const tooltip = ensureTooltipView();
  if (tooltipView.pinned && tooltipView.activeTrigger !== trigger) return;
  cancelTooltipClose();

  if (tooltipView.activeTrigger === trigger && !tooltip.hidden) {
    tooltipView.pinned ||= pinned;
    return;
  }

  setTooltipExpanded(tooltipView.activeTrigger, false);
  tooltipView.activeTrigger = trigger;
  tooltipView.pinned = pinned;
  setTooltipExpanded(trigger, true);

  const abilityName = trigger.dataset.tooltipName || 'Ability';
  const spellId = trigger.dataset.tooltipSpell;
  const ptrLabel = `${state.patch?.status || 'PTR'} ${state.patch?.id || ''}`.trim();
  tooltip.replaceChildren(
    tooltipHeader(abilityName),
    node('div', { className: 'ability-tooltip-grid' }, [
      loadingTooltipPane('Live', spellId, 'live'),
      loadingTooltipPane(ptrLabel, spellId, 'ptr'),
    ]),
    node('p', { className: 'ability-tooltip-footnote', text: TOOLTIP_DISCLAIMER }),
  );
  tooltip.hidden = false;
  positionAbilityTooltip();

  const request = Symbol('tooltip-request');
  tooltipView.request = request;
  const [liveResult, ptrResult] = await Promise.all([
    requestWowheadTooltip(trigger.dataset.tooltipSpell, 'live'),
    requestWowheadTooltip(trigger.dataset.tooltipSpell, 'ptr'),
  ]);
  if (tooltipView.request !== request || tooltipView.activeTrigger !== trigger) return;

  const live = loadedTooltipPane('Live', liveResult, spellId, 'live');
  const ptr = loadedTooltipPane(ptrLabel, ptrResult, spellId, 'ptr');
  let status = 'Tooltip unavailable';
  if (live.text && ptr.text) status = live.text === ptr.text ? 'Tooltip text matches' : 'Tooltip text differs';
  else if (live.text || ptr.text) status = 'One environment is unavailable';
  tooltip.replaceChildren(
    tooltipHeader(abilityName, status),
    node('div', { className: 'ability-tooltip-grid' }, [live.element, ptr.element]),
    node('p', { className: 'ability-tooltip-footnote', text: TOOLTIP_DISCLAIMER }),
  );
  positionAbilityTooltip();
}

function cancelTooltipClose() {
  window.clearTimeout(tooltipView.closeTimer);
  tooltipView.closeTimer = null;
}

function scheduleTooltipClose() {
  cancelTooltipClose();
  if (tooltipView.pinned) return;
  tooltipView.closeTimer = window.setTimeout(() => hideAbilityTooltip(), 140);
}

function hideAbilityTooltip(force = false) {
  if (tooltipView.pinned && !force) return;
  cancelTooltipClose();
  setTooltipExpanded(tooltipView.activeTrigger, false);
  tooltipView.request = null;
  tooltipView.activeTrigger = null;
  tooltipView.pinned = false;
  if (tooltipView.element) tooltipView.element.hidden = true;
}

function closeAbilityTooltip() {
  const button = tooltipView.activeTrigger?.querySelector('.ability-name-trigger');
  button?.focus({ preventScroll: true });
  hideAbilityTooltip(true);
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
      pvpImpact: checkpoint.pvpImpact,
      classInfo,
    };
  }).filter((change) => {
    if (!change) return false;
    if (state.classId !== 'all' && change.classInfo.id !== state.classId) return false;
    if (state.spec !== 'all' && change.spec !== state.spec) return false;
    if (state.direction !== 'all' && change.direction !== state.direction) return false;
    if (state.hidePvpExcluded && change.pvpImpact) return false;
    if (state.talentsOnly && !change.isTalent) return false;
    if (state.revisedOnly && change.history.length < 2) return false;
    if (query) {
      const haystack = [
        change.classInfo.name,
        change.spec,
        change.category,
        change.isTalent ? 'talent' : null,
        change.subject,
        change.text,
      ]
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

function classMark(classInfo, icon) {
  const mark = node('span', { className: `class-mark${icon ? ' has-icon' : ''}` });
  const showFallback = () => {
    mark.classList.remove('has-icon');
    mark.textContent = classInfo.mark;
    mark.style.setProperty('--class-color', classInfo.color);
  };

  if (!icon) {
    showFallback();
    return mark;
  }

  const image = node('img', {
    attrs: { src: icon, alt: '', width: '30', height: '30' },
  });
  let retried = false;
  image.addEventListener('load', () => {
    mark.classList.add('has-icon');
    mark.style.removeProperty('--class-color');
    mark.replaceChildren(image);
  });
  image.addEventListener('error', () => {
    showFallback();
    if (retried) return;
    retried = true;
    const retryUrl = new URL(icon, location.href);
    retryUrl.searchParams.set('retry', '1');
    window.setTimeout(() => {
      image.src = retryUrl.href;
    }, 250);
  });
  mark.append(image);
  return mark;
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
    const mark = classMark(classInfo, icon);

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
      const specOptions = [
        { id: 'all', label: 'All specializations', count: classInfo.changes.length },
        ...specs.map((spec) => ({
          id: spec,
          label: spec,
          count: classInfo.changes.filter((change) => change.spec === spec).length,
        })),
      ];
      item.append(node('div', {
        className: 'class-submenu',
        attrs: { id: submenuId, 'aria-label': `${classInfo.name} specializations` },
      }, specOptions.map((specOption) => node('button', {
        className: `class-spec-button${state.spec === specOption.id ? ' is-active' : ''}`,
        attrs: {
          type: 'button',
          'data-class-spec': specOption.id,
          'aria-label': `${specOption.label}, ${specOption.count.toLocaleString()} changes`,
          'aria-pressed': String(state.spec === specOption.id),
        },
      }, [
        node('span', { className: 'class-spec-label', text: specOption.label }),
        node('span', {
          className: 'class-spec-count',
          text: specOption.count.toLocaleString(),
          attrs: { 'aria-hidden': 'true' },
        }),
      ]))));
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
  const directionLabels = { buff: 'Buff', nerf: 'Nerf', fixed: 'Fix', changed: 'Changed' };
  const metadata = [node('span', { className: 'direction-label', text: directionLabels[change.direction] })];
  const pvpLabels = { excluded: 'PvP excluded', unchanged: 'PvP unchanged' };
  if (change.pvpImpact) {
    metadata.push(node('span', {
      className: 'pvp-scope-label',
      text: pvpLabels[change.pvpImpact],
    }));
  }
  const abilityType = change.abilityType || (change.isTalent ? 'talent' : null);
  if (abilityType) {
    metadata.push(node('span', {
      className: `ability-type-label is-${abilityType}`,
      text: abilityType === 'talent' ? 'Talent' : 'Spell',
    }));
  }
  if (change.spellId) {
    metadata.push(node('span', {
      className: 'ability-tooltip-hint',
      text: 'Live ↔ PTR',
      attrs: { 'aria-hidden': 'true' },
    }));
  }
  if (state.classId === 'all' && !NON_SPECIALIZATIONS.has(change.spec)) {
    metadata.push(node('span', { className: 'category-label', text: `· ${change.spec}` }));
  }
  if (change.category) metadata.push(node('span', { className: 'category-label', text: `· ${change.category}` }));

  const icon = change.icon ? node('img', {
    className: 'ability-icon',
    attrs: {
      src: change.icon,
      alt: '',
      width: '44',
      height: '44',
      loading: 'lazy',
      decoding: 'async',
      'aria-hidden': 'true',
    },
  }) : null;
  const tooltipName = change.subject;
  const title = change.spellId
    ? node('button', {
        className: 'ability-name-trigger',
        text: change.subject,
        attrs: {
          type: 'button',
          'aria-label': `Compare Live and PTR tooltips for ${tooltipName}`,
          'aria-controls': 'ability-tooltip',
          'aria-expanded': 'false',
        },
      })
    : document.createTextNode(change.subject);
  const name = node('div', {
    className: `change-name${change.spellId ? ' has-tooltip' : ''}`,
    attrs: change.spellId ? {
      'data-tooltip-spell': change.spellId,
      'data-tooltip-name': tooltipName,
    } : {},
  }, [
    icon,
    node('div', { className: 'change-name-copy' }, [
      node('div', { className: 'change-meta' }, metadata),
      node('h3', {}, [title]),
    ]),
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
    attrs: {
      'data-direction': change.direction,
      'data-value-kind': hasNumericComparison ? 'numeric' : 'qualitative',
      'data-change-type': abilityType || 'other',
    },
  }, [node('div', { className: 'card-main' }, [name, content]), footer]);
}

function renderChanges() {
  hideAbilityTooltip(true);
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
  state.talentsOnly = false;
  state.hidePvpExcluded = false;
  state.round = 'all';
  state.openClassMenu = null;
  state.menuCloseScrollY = null;
  elements.search.value = '';
  elements.revisedOnly.checked = false;
  elements.talentsOnly.checked = false;
  elements.pvpFilter.checked = false;
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
  elements.list.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const trigger = tooltipAnchor(event.target);
    if (!trigger) return;
    showAbilityTooltip(trigger);
  });
  elements.list.addEventListener('pointerout', (event) => {
    const leaving = tooltipAnchor(event.target);
    const entering = event.relatedTarget instanceof Element ? tooltipAnchor(event.relatedTarget) : null;
    if (leaving && leaving !== entering) scheduleTooltipClose();
  });
  elements.list.addEventListener('focusin', (event) => {
    const trigger = tooltipAnchor(event.target);
    if (trigger) showAbilityTooltip(trigger);
  });
  elements.list.addEventListener('focusout', (event) => {
    const leaving = tooltipAnchor(event.target);
    const entering = event.relatedTarget instanceof Element ? tooltipAnchor(event.relatedTarget) : null;
    if (leaving && leaving !== entering) scheduleTooltipClose();
  });
  elements.list.addEventListener('click', (event) => {
    const trigger = tooltipAnchor(event.target);
    if (!trigger) return;
    if (tooltipView.activeTrigger === trigger && tooltipView.pinned) {
      hideAbilityTooltip(true);
      return;
    }
    showAbilityTooltip(trigger, true);
  });
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
  elements.talentsOnly.addEventListener('change', (event) => {
    state.talentsOnly = event.target.checked;
    renderChanges();
  });
  elements.revisedOnly.addEventListener('change', (event) => {
    state.revisedOnly = event.target.checked;
    renderChanges();
  });
  elements.pvpFilter.addEventListener('change', (event) => {
    state.hidePvpExcluded = event.target.checked;
    renderChanges();
  });
  $('#clear-filters').addEventListener('click', resetFilters);
  window.addEventListener('scroll', dismissClassMenuAfterSection, { passive: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && tooltipView.element && !tooltipView.element.hidden) {
      closeAbilityTooltip();
    }
    if (event.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      event.preventDefault();
      elements.search.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-tooltip-close]')) {
      closeAbilityTooltip();
      return;
    }
    if (!tooltipView.pinned || tooltipAnchor(event.target) || tooltipView.element?.contains(event.target)) return;
    hideAbilityTooltip(true);
  });
  window.addEventListener('scroll', positionAbilityTooltip, { passive: true });
  window.addEventListener('resize', positionAbilityTooltip);
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
