/* section-card: a titled container card for Home Assistant dashboards.
 * Header (icon + title + optional status on the right), a thin separator,
 * then any Lovelace cards rendered with a transparent background.
 * No dependency: plain custom elements, cards created with the Lovelace helpers. */

const VERSION = '0.2.0';
const TEMPLATE_RE = /^\s*\[\[\[([\s\S]*)\]\]\]\s*$/;

// "red", "deep-purple", "primary" (Home Assistant color names) or any CSS color
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const cssColor = (c) => (/^[a-z-]+$/.test(c) ? `var(--${c}-color, ${c})` : c);

const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  .header {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    height: var(--section-card-header-height, 40px);
    padding: 0 var(--section-card-padding, 16px);
    box-sizing: border-box; line-height: 1;
    background: var(--section-card-header-background, var(--ha-card-background, var(--card-background-color)));
  }
  .header.clickable, .status.clickable, #chevron { cursor: pointer; }
  .title {
    display: flex; align-items: center; gap: 8px; min-width: 0;
    font-size: 15px; font-weight: bold; line-height: 20px; color: var(--primary-text-color);
  }
  .title span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .title ha-icon {
    --mdc-icon-size: 20px; width: 20px; height: 20px; flex-shrink: 0;
    color: var(--section-card-icon-color, #fff); opacity: var(--section-card-icon-opacity, 0.35);
  }
  .right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .status {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 13px; font-weight: bold;
    color: var(--section-card-status-color, var(--secondary-text-color));
  }
  .status ha-icon { --mdc-icon-size: 14px; width: 14px; height: 14px; display: flex; }
  .seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 9px; background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
  .seg button {
    font: inherit; font-size: 12px; font-weight: 600; line-height: 16px; padding: 3px 10px;
    border: 0; border-radius: 7px; background: none; color: var(--secondary-text-color); cursor: pointer;
  }
  .seg button.on {
    background: color-mix(in srgb, var(--primary-text-color) 16%, transparent);
    color: var(--section-card-status-color, var(--primary-text-color));
  }
  .pick {
    font: inherit; font-size: 12px; padding: 3px 6px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color);
  }
  #chevron {
    --mdc-icon-size: 20px; width: 20px; height: 20px; display: flex;
    color: var(--secondary-text-color); transition: transform 0.2s;
  }
  .collapsed #chevron { transform: rotate(-90deg); }
  [hidden] { display: none !important; }
  .separator { height: 1px; background: var(--section-card-separator-color, rgba(152, 152, 157, 0.3)); }
  #body { display: flex; flex-direction: column; }
  .collapsed #body, .collapsed .header + .separator { display: none; }
  .bare .header, .bare .header + .separator { display: none; }
`;

class SectionCard extends HTMLElement {
  static getStubConfig() {
    return { icon: 'mdi:home', title: 'Section', cards: [] };
  }

  static getConfigElement() {
    return document.createElement('section-card-editor');
  }

  setConfig(config) {
    if (!config) throw new Error('section-card: invalid configuration');
    if (config.cards !== undefined && !Array.isArray(config.cards)) {
      throw new Error('section-card: "cards" must be a list');
    }
    this._config = { separator: true, ...config };
    this._fns = {};
    ['title', 'status', 'status_color', 'status_icon'].forEach((k) => { this._fns[k] = this._compile(config[k]); });
    this._last = {};
    this._render();
    this._buildCards();
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;
    const title = this._value('title');
    const status = this._value('status');
    const icon = this._value('status_icon');
    const color = this._value('status_color');
    if (this._changed('title', title)) root.getElementById('title').innerHTML = title;
    if (this._changed('status', status)) root.getElementById('status').innerHTML = status;
    if (this._changed('status_icon', icon)) {
      const el = root.getElementById('status-icon');
      el.hidden = !icon;
      el.icon = icon;
    }
    if (this._changed('status_color', color)) root.querySelector('.status').style.color = color ? cssColor(color) : '';
    root.querySelector('.status').hidden = !status && !icon;
    (this._cards || []).forEach((card) => { card.hass = hass; });
  }

  get hass() { return this._hass; }

  // button-card style JS templates: [[[ return ...; ]]]
  _compile(tpl) {
    if (typeof tpl !== 'string') return null;
    const m = tpl.match(TEMPLATE_RE);
    if (!m) return null;
    try {
      return new Function('states', 'entity', 'hass', 'variables', 'user', m[1]);
    } catch (e) {
      return () => `⚠ ${e.message}`;
    }
  }

  // status_type: state -> the formatted state (or attribute) of an entity, no template needed
  _stateStatus() {
    const c = this._config;
    const hass = this._hass;
    const stateObj = hass && hass.states[c.status_entity || c.entity];
    if (!stateObj) return '';
    const text = c.status_attribute
      ? (hass.formatEntityAttributeValue ? hass.formatEntityAttributeValue(stateObj, c.status_attribute) : stateObj.attributes[c.status_attribute])
      : (hass.formatEntityState ? hass.formatEntityState(stateObj) : stateObj.state);
    return esc(text);
  }

  // status_type: select -> the options of an input_select / select as a segmented control (a list above five options)
  _selectStatus() {
    const c = this._config;
    const stateObj = this._hass && this._hass.states[c.status_entity || c.entity];
    const options = stateObj && stateObj.attributes.options;
    if (!Array.isArray(options)) return '';
    if (options.length > 5) {
      return `<select class="pick">${options.map((o) => `<option${o === stateObj.state ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    }
    return `<div class="seg">${options.map((o) => `<button data-option="${esc(o)}" class="${o === stateObj.state ? 'on' : ''}">${esc(o)}</button>`).join('')}</div>`;
  }

  _select(option) {
    const id = this._config.status_entity || this._config.entity;
    this._hass.callService(id.split('.')[0], 'select_option', { entity_id: id, option });
  }

  _value(key) {
    if (key === 'status' && this._config.status_type === 'state') return this._stateStatus();
    if (key === 'status' && this._config.status_type === 'select') return this._selectStatus();
    return this._run(this._fns[key], this._config[key]);
  }

  _run(fn, raw) {
    if (!fn) return raw == null ? '' : String(raw);
    const hass = this._hass;
    if (!hass) return '';
    try {
      const entity = this._config.entity ? hass.states[this._config.entity] : undefined;
      const r = fn.call(this, hass.states, entity, hass, this._config.variables || {}, hass.user);
      return r == null ? '' : String(r);
    } catch (e) {
      return `⚠ ${e.message}`;
    }
  }

  _changed(key, value) {
    if (this._last[key] === value) return false;
    this._last[key] = value;
    return true;
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    const c = this._config;
    const tap = this._action(c.tap_action, c.entity ? 'more-info' : 'none');
    const statusTap = this._action(c.status_tap_action, null);
    const hold = this._action(c.hold_action, null);
    const headerToggles = c.collapsible && !tap;
    // Nothing to show in the header: the card is a plain container
    const bare = !c.title && !c.icon && !c.status && !c.status_icon && !c.status_type && !c.collapsible;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}${c.extra_styles || ''}</style>
      <ha-card class="${bare ? 'bare' : ''}">
        <div class="header${tap || headerToggles ? ' clickable' : ''}">
          <div class="title"><ha-icon id="icon" hidden></ha-icon><span id="title"></span></div>
          <div class="right">
            <div class="status${statusTap ? ' clickable' : ''}" hidden><ha-icon id="status-icon" hidden></ha-icon><span id="status"></span></div>
            ${c.collapsible ? '<ha-icon id="chevron" icon="mdi:chevron-down"></ha-icon>' : ''}
          </div>
        </div>
        ${c.separator ? '<div class="separator"></div>' : ''}
        <div id="body"></div>
      </ha-card>`;
    const root = this.shadowRoot;
    const card = root.querySelector('ha-card');
    const header = root.querySelector('.header');
    if (c.icon) {
      const icon = root.getElementById('icon');
      icon.icon = c.icon;
      icon.hidden = false;
    }
    if (c.color) { // one accent for the icon, the status and the line
      const color = cssColor(String(c.color));
      card.style.setProperty('--section-card-icon-color', color);
      card.style.setProperty('--section-card-icon-opacity', '1');
      card.style.setProperty('--section-card-status-color', color);
      card.style.setProperty('--section-card-separator-color', `color-mix(in srgb, ${color} 40%, transparent)`);
    }
    let timer = null, held = false;
    if (hold) {
      header.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; this._fire('hold'); }, 500); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => header.addEventListener(ev, () => clearTimeout(timer)));
    }
    if (tap) header.addEventListener('click', () => { if (!held) this._fire('tap'); });
    else if (headerToggles) header.addEventListener('click', () => { if (!held) this._toggle(); });
    if (statusTap) {
      root.querySelector('.status').addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._fire('tap', { entity: (c.status_type === 'state' && c.status_entity) || c.entity, tap_action: statusTap });
      });
    }
    if (c.status_type === 'select') { // a click on the selector picks an option, it never reaches the header
      const status = root.querySelector('.status');
      status.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const button = ev.target.closest('[data-option]');
        if (button) this._select(button.dataset.option);
      });
      status.addEventListener('change', (ev) => this._select(ev.target.value));
    }
    if (c.collapsible) {
      root.getElementById('chevron').addEventListener('click', (ev) => { ev.stopPropagation(); this._toggle(); });
      card.classList.toggle('collapsed', this._collapsed());
    }
  }

  // The folded state is kept per browser, per dashboard and per title
  _collapseKey() {
    const c = this._config;
    return `section-card:${c.collapse_id || `${location.pathname}:${c.title || c.icon || ''}`}`;
  }

  _collapsed() {
    let saved = null;
    try { saved = localStorage.getItem(this._collapseKey()); } catch (e) { /* private window */ }
    return saved === null ? !!this._config.collapsed : saved === '1';
  }

  _toggle() {
    const card = this.shadowRoot.querySelector('ha-card');
    const collapsed = card.classList.toggle('collapsed');
    try { localStorage.setItem(this._collapseKey(), collapsed ? '1' : '0'); } catch (e) { /* private window */ }
  }

  _action(action, fallback) {
    const a = action || (fallback ? { action: fallback } : null);
    return a && a.action && a.action !== 'none' ? a : null;
  }

  // Let the frontend run the action (more-info, toggle, navigate, perform-action, confirmation...).
  async _fire(action, config) {
    const c = this._config;
    let cfg = config || { entity: c.entity, tap_action: c.tap_action || { action: c.entity ? 'more-info' : 'none' }, hold_action: c.hold_action };
    const key = `${action}_action`;
    const act = cfg[key];
    if (act && act.confirmation) { // the card asks by itself, then hands the action over without its confirmation
      const { confirmation, ...rest } = act;
      const exempt = (confirmation.exemptions || []).some((e) => e.user === this._hass.user.id);
      if (!exempt && !(await confirmDialog(this._confirmSpec(rest, confirmation === true ? {} : confirmation, cfg.entity)))) return;
      cfg = { ...cfg, [key]: rest };
    }
    this.dispatchEvent(new CustomEvent('hass-action', { bubbles: true, composed: true, detail: { config: cfg, action } }));
  }

  // Texts of the confirmation: the ones of the config (templates allowed), else written from the action and the entity state
  _confirmSpec(act, conf, entityId) {
    const hass = this._hass;
    const t = STRINGS[(hass.language || 'en').slice(0, 2)] || STRINGS.en;
    const text = (v) => this._run(this._compile(v), v);
    const stateObj = hass.states[entityId];
    let auto = null;
    if (act.action === 'toggle' && stateObj) {
      const domain = entityId.split('.')[0];
      const s = stateObj.state;
      const kind = domain === 'lock' ? (s === 'locked' ? 'unlock' : 'lock')
        : domain === 'cover' ? (s === 'closed' ? 'open' : 'shut')
          : (['off', 'unavailable', 'unknown', 'idle', 'standby'].includes(s) ? 'on' : 'off');
      auto = { verb: t[kind][0], question: t[kind][1].replace('{n}', stateObj.attributes.friendly_name || entityId), icon: ICONS[kind] };
    }
    return {
      verb: text(conf.confirm_text) || (auto ? auto.verb : t.confirm),
      icon: text(conf.icon) || (auto ? auto.icon : 'mdi:check'),
      question: text(conf.text) || text(conf.title) || (auto ? auto.question : t.confirm_q),
      description: text(conf.description),
      close: t.close,
    };
  }

  async _buildCards() {
    const body = this.shadowRoot.getElementById('body');
    body.innerHTML = '';
    this._cards = [];
    const configs = this._config.cards || [];
    if (!configs.length) return;
    const helpers = await window.loadCardHelpers();
    if (body !== this.shadowRoot.getElementById('body')) return; // re-rendered meanwhile
    this._cards = configs.map((cfg) => this._createCard(helpers, cfg));
    this._cards.forEach((card) => body.appendChild(card));
    if (this._hass) this._cards.forEach((card) => { card.hass = this._hass; });
  }

  _createCard(helpers, cfg) {
    if (cfg && cfg.type === 'divider') { // a thin line, like the one under the header
      const line = document.createElement('div');
      line.className = 'separator';
      return line;
    }
    const el = helpers.createCardElement(cfg);
    el.addEventListener('ll-rebuild', (ev) => {
      ev.stopPropagation();
      const fresh = this._createCard(helpers, cfg);
      this._cards[this._cards.indexOf(el)] = fresh;
      el.replaceWith(fresh);
      if (this._hass) fresh.hass = this._hass;
    });
    this._flatten(el);
    return el;
  }

  // Make the inner ha-card blend into the section (background, border, shadow, radius).
  _flatten(el, tries = 0) {
    const card = (el.shadowRoot && el.shadowRoot.querySelector('ha-card')) || el.querySelector('ha-card');
    if (card) {
      card.style.background = 'transparent';
      card.style.border = 'none';
      card.style.boxShadow = 'none';
      card.style.borderRadius = '0';
      card.style.setProperty('--ha-card-border-width', '0');
      return;
    }
    if (tries < 50) setTimeout(() => this._flatten(el, tries + 1), 200); // lazy-loaded cards can take a while
  }

  async getCardSize() {
    let size = 1;
    for (const card of this._cards || []) {
      if (typeof card.getCardSize === 'function') {
        try { size += await card.getCardSize(); } catch (e) { size += 1; }
      } else size += 1;
    }
    return size;
  }

  getGridOptions() {
    return { columns: 'full', rows: 'auto' };
  }
}

/* Confirmation dialog of the card, used instead of the Home Assistant one for the actions of the header. */

const STRINGS = {
  en: {
    close: 'Close', confirm: 'Confirm', confirm_q: 'Confirm this action?',
    on: ['Turn on', 'Turn on {n}?'], off: ['Turn off', 'Turn off {n}?'],
    lock: ['Lock', 'Lock {n}?'], unlock: ['Unlock', 'Unlock {n}?'],
    open: ['Open', 'Open {n}?'], shut: ['Close', 'Close {n}?'],
  },
  fr: {
    close: 'Fermer', confirm: 'Confirmer', confirm_q: 'Confirmer cette action ?',
    on: ['Allumer', 'Allumer {n} ?'], off: ['Éteindre', 'Éteindre {n} ?'],
    lock: ['Verrouiller', 'Verrouiller {n} ?'], unlock: ['Déverrouiller', 'Déverrouiller {n} ?'],
    open: ['Ouvrir', 'Ouvrir {n} ?'], shut: ['Fermer', 'Fermer {n} ?'],
  },
};

const ICONS = {
  on: 'mdi:power', off: 'mdi:power', lock: 'mdi:lock-outline', unlock: 'mdi:lock-open-variant-outline',
  open: 'mdi:arrow-up-box', shut: 'mdi:arrow-down-box',
};

const DIALOG_STYLE = `
  :host { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
    font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
  .veil { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.55); }
  .sheet { position: relative; width: min(440px, calc(100vw - 24px)); box-sizing: border-box; padding: 16px;
    border-radius: 28px; background: var(--section-card-dialog-background, #1c1c1e); color: var(--section-card-dialog-color, #ebebf0); }
  .bar { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 14px; margin-bottom: 14px; }
  .bar span { flex: 1; }
  button { font: inherit; color: inherit; border: 0; cursor: pointer; }
  .x { width: 44px; height: 44px; border-radius: 22px; background: rgba(255, 255, 255, 0.08);
    display: inline-flex; align-items: center; justify-content: center; }
  .txt { margin: 0 2px 14px; }
  .big { font-size: 20px; font-weight: 700; line-height: 1.2; }
  small { display: block; margin-top: 3px; font-size: 13px; color: #a5a5ac; }
  small:empty { display: none; }
  .go { width: 100%; height: 52px; border-radius: 26px; background: rgba(255, 255, 255, 0.1);
    display: flex; align-items: center; justify-content: center; gap: 10px; font-weight: 700; font-size: 16px; }
  .go:hover, .x:hover { background: rgba(255, 255, 255, 0.16); }
`;

// Resolves true when the action is confirmed, false when the dialog is closed (cross, veil, Escape)
function confirmDialog(spec) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${DIALOG_STYLE}</style>
      <div class="veil"></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="bar"><ha-icon></ha-icon><span></span><button class="x"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="txt"><div class="big"></div><small></small></div>
        <button class="go"><ha-icon></ha-icon><span></span></button>
      </div>`;
    root.querySelector('.sheet').setAttribute('aria-label', spec.question);
    root.querySelector('.bar ha-icon').icon = spec.icon;
    root.querySelector('.bar span').textContent = spec.verb;
    root.querySelector('.x').setAttribute('aria-label', spec.close);
    root.querySelector('.big').textContent = spec.question;
    root.querySelector('small').textContent = spec.description;
    root.querySelector('.go ha-icon').icon = spec.icon;
    root.querySelector('.go span').textContent = spec.verb;
    const onKey = (ev) => { if (ev.key === 'Escape') done(false); };
    const done = (ok) => {
      window.removeEventListener('keydown', onKey);
      host.remove();
      resolve(ok);
    };
    root.querySelector('.veil').addEventListener('click', () => done(false));
    root.querySelector('.x').addEventListener('click', () => done(false));
    root.querySelector('.go').addEventListener('click', () => done(true));
    window.addEventListener('keydown', onKey);
    document.body.appendChild(host);
    root.querySelector('.go').focus();
  });
}

/* Visual editor: a Home Assistant form laid out by zone of the card (title, right of the title, tap on the header,
 * look), then the body cards in the stack editor of the frontend. */

// Field labels by name, helpers as h_<name>, groups as g_<name>, choices as o_<value>
const LABELS = {
  en: {
    title: 'Title', icon: 'Icon',
    g_status: 'Right of the title', g_tap: 'Tap on the header', g_look: 'Look', g_cards: 'Body cards',
    h_cards: 'One card per tab, shown one under the other. "+" adds a card.',
    status_mode: 'Show', o_none: 'Nothing', o_text: 'A text', o_state: 'The state of an entity', o_template: 'A JavaScript template', o_select: 'An option selector',
    status_list: 'List to drive', h_status_list: 'An input_select or a select. Its options show as buttons, as a list above five.',
    status_text: 'Text', status_tpl: 'Template',
    h_status_tpl: 'Between [[[ and ]]]. Variables: entity, states, hass, user. The result can be HTML.',
    status_entity: 'Entity to show', h_status_entity: 'Empty: the entity of the header.',
    status_attribute: 'Attribute', h_status_attribute: 'Empty: the state of the entity.',
    status_icon: 'Icon', status_color: 'Color',
    status_clickable: 'Own action on click', h_status_clickable: 'Off: a click here runs the action of the header.',
    status_tap_action: 'On click', status_confirm: 'Ask for confirmation',
    entity: 'Entity of the header',
    h_entity: 'Target of "More info" and "Toggle". Also the default entity for the right of the title.',
    tap_action: 'Tap', h_tap_action: 'No choice: opens the info of the entity, when there is one.',
    tap_confirm: 'Ask for confirmation', hold_action: 'Long press', hold_confirm: 'Ask for confirmation',
    color: 'Accent color', h_color: 'Tints the icon, the text on the right and the line.',
    separator: 'Line under the header', collapsible: 'Collapsible',
    h_collapsible: 'Adds a chevron. The folded state is remembered on each device.', collapsed: 'Collapsed by default',
    cards: 'Cards (YAML)',
  },
  fr: {
    title: 'Titre', icon: 'Icône',
    g_status: 'À droite du titre', g_tap: "Appui sur l'en-tête", g_look: 'Apparence', g_cards: 'Cartes du contenu',
    h_cards: "Une carte par onglet, affichées l'une sous l'autre. « + » en ajoute une.",
    status_mode: 'Afficher', o_none: 'Rien', o_text: 'Un texte', o_state: "L'état d'une entité", o_template: 'Un template JavaScript', o_select: "Un sélecteur d'options",
    status_list: 'Liste à piloter', h_status_list: "Un input_select ou un select. Ses options s'affichent en boutons, en liste déroulante au-delà de cinq.",
    status_text: 'Texte', status_tpl: 'Template',
    h_status_tpl: 'Entre [[[ et ]]]. Variables : entity, states, hass, user. Le résultat peut être du HTML.',
    status_entity: 'Entité à afficher', h_status_entity: "Vide : l'entité de l'en-tête.",
    status_attribute: 'Attribut', h_status_attribute: "Vide : l'état de l'entité.",
    status_icon: 'Icône', status_color: 'Couleur',
    status_clickable: 'Action propre au clic', h_status_clickable: "Désactivé : un clic ici déclenche l'action de l'en-tête.",
    status_tap_action: 'Au clic', status_confirm: 'Demander confirmation',
    entity: "Entité de l'en-tête",
    h_entity: "Cible de « Plus d'infos » et « Basculer ». Sert aussi d'entité par défaut à droite du titre.",
    tap_action: 'Appui', h_tap_action: "Sans choix : ouvre les infos de l'entité, s'il y en a une.",
    tap_confirm: 'Demander confirmation', hold_action: 'Appui long', hold_confirm: 'Demander confirmation',
    color: "Couleur d'accent", h_color: "Teinte l'icône, le texte de droite et le trait.",
    separator: "Trait sous l'en-tête", collapsible: 'Repliable',
    h_collapsible: "Ajoute un chevron. L'état replié est mémorisé sur chaque appareil.", collapsed: 'Replié par défaut',
    cards: 'Cartes (YAML)',
  },
};

const hasAction = (a) => !!(a && a.action && a.action !== 'none');

// What the right of the title shows, read from the options when the user has not chosen in this session
const statusMode = (c) => (c.status_type === 'state' || c.status_type === 'select' ? c.status_type
  : TEMPLATE_RE.test(c.status || '') ? 'template'
    : (c.status || c.status_icon) ? 'text' : 'none');

// The fields follow the chosen content and the "own action" switch
const statusSchema = (t, data) => {
  const mode = data.status_mode;
  if (mode === 'none') return [modeField(t)];
  return [
    modeField(t),
    ...(mode === 'text' ? [{ name: 'status', label: 'status_text', selector: { text: {} } }] : []),
    ...(mode === 'template' ? [{ name: 'status', label: 'status_tpl', selector: { text: { multiline: true } } }] : []),
    ...(mode === 'select' ? [
      { name: 'status_entity', label: 'status_list', selector: { entity: { domain: ['input_select', 'select'] } } },
    ] : []),
    ...(mode === 'state' ? [
      { name: 'status_entity', selector: { entity: {} } },
      { name: 'status_attribute', selector: { attribute: { entity_id: data.status_entity || data.entity } } },
    ] : []),
    { type: 'grid', name: '', schema: [
      { name: 'status_icon', selector: { icon: {} } },
      { name: 'status_color', selector: { ui_color: {} } },
    ] },
    ...(mode === 'select' ? [] : [{ name: 'status_clickable', selector: { boolean: {} } }]),
    ...(data.status_clickable && mode !== 'select' ? [
      { name: 'status_tap_action', selector: { ui_action: { default_action: 'more-info' } } },
      { name: 'status_confirm', selector: { boolean: {} } },
    ] : []),
  ];
};

const modeField = (t) => ({ name: 'status_mode', selector: { select: { mode: 'dropdown',
  options: ['none', 'text', 'state', 'select', 'template'].map((value) => ({ value, label: t[`o_${value}`] })) } } });

const schema = (t, data, yamlCards) => [
  { name: 'title', selector: { text: {} } },
  { name: 'icon', selector: { icon: {} } },
  { type: 'expandable', name: '', flatten: true, title: t.g_status, icon: 'mdi:dock-right', schema: statusSchema(t, data) },
  { type: 'expandable', name: '', flatten: true, title: t.g_tap, icon: 'mdi:gesture-tap', schema: [
    { name: 'entity', selector: { entity: {} } },
    { name: 'tap_action', selector: { ui_action: { default_action: data.entity ? 'more-info' : 'none' } } },
    ...(hasAction(data.tap_action) ? [{ name: 'tap_confirm', selector: { boolean: {} } }] : []),
    { name: 'hold_action', selector: { ui_action: { default_action: 'none' } } },
    ...(hasAction(data.hold_action) ? [{ name: 'hold_confirm', selector: { boolean: {} } }] : []),
  ] },
  { type: 'expandable', name: '', flatten: true, title: t.g_look, icon: 'mdi:palette-outline', schema: [
    { name: 'color', selector: { ui_color: {} } },
    { name: 'separator', selector: { boolean: {} } },
    { name: 'collapsible', selector: { boolean: {} } },
    ...(data.collapsible ? [{ name: 'collapsed', selector: { boolean: {} } }] : []),
  ] },
  ...(yamlCards ? [{ name: 'cards', selector: { object: {} } }] : []),
];

// The switches of the form that are not options: [switch, action it adds the confirmation to]
const CONFIRM_SWITCHES = [['tap_confirm', 'tap_action'], ['hold_confirm', 'hold_action'], ['status_confirm', 'status_tap_action']];

// Class of a built-in card. They are lazy-loaded: creating one starts the download, the class comes later
async function builtIn(type, config) {
  const helpers = await window.loadCardHelpers();
  helpers.createCardElement({ type, ...config });
  const tag = `hui-${type}-card`;
  await Promise.race([customElements.whenDefined(tag), new Promise((r) => setTimeout(r, 5000))]);
  return customElements.get(tag);
}

class SectionCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  set lovelace(lovelace) { // needed by the card picker of the stack editor
    this._lovelace = lovelace;
    this._update();
  }

  // The editor of the built-in vertical stack edits the body: tabs, card picker, move, delete
  async _loadStack() {
    try {
      const stack = await (await builtIn('vertical-stack', { cards: [] })).getConfigElement();
      stack.addEventListener('config-changed', (ev) => {
        ev.stopPropagation();
        const config = { ...this._config, cards: ev.detail.config.cards };
        this.dispatchEvent(new CustomEvent('config-changed', { bubbles: true, composed: true, detail: { config } }));
      });
      return stack;
    } catch (e) {
      return null; // the body is then edited as YAML in the form
    }
  }

  async connectedCallback() {
    if (this._form) return;
    if (!customElements.get('ha-form')) { // lazy-loaded by the frontend: a built-in editor pulls it in
      await (await builtIn('button', {})).getConfigElement();
    }
    const stack = await this._loadStack();
    if (this._form) return;
    this._form = document.createElement('ha-form');
    this._form.addEventListener('value-changed', (ev) => {
      ev.stopPropagation();
      this._changed(ev.detail.value);
    });
    this.appendChild(this._form);
    if (stack) {
      this._stackLabel = document.createElement('div');
      this._stackLabel.style.cssText = 'margin: 24px 0 8px; color: var(--primary-text-color);';
      this._stackLabel.innerHTML = '<div style="font-weight: 500"></div><div style="font-size: 12px; color: var(--secondary-text-color); margin-top: 2px"></div>';
      this._stack = stack;
      this.append(this._stackLabel, stack);
    }
    this._update();
  }

  _update() {
    if (!this._form || !this._hass || !this._config) return;
    const t = LABELS[(this._hass.language || 'en').slice(0, 2)] || LABELS.en;
    const c = this._config;
    this._form.hass = this._hass;
    this._form.computeLabel = (s) => t[s.label || s.name] || s.name;
    this._form.computeHelper = (s) => t[`h_${s.label || s.name}`];
    const data = { separator: true, cards: [], ...c, status_clickable: !!c.status_tap_action, status_mode: this._mode || statusMode(c) };
    CONFIRM_SWITCHES.forEach(([sw, key]) => { data[sw] = !!(c[key] && c[key].confirmation); });
    this._form.schema = schema(t, data, !this._stack);
    this._form.data = data;
    if (!this._stack) return;
    this._stackLabel.firstChild.textContent = t.g_cards;
    this._stackLabel.lastChild.textContent = t.h_cards;
    this._stack.hass = this._hass;
    this._stack.lovelace = this._lovelace;
    this._stack.setConfig({ type: 'vertical-stack', cards: c.cards || [] });
    if (!this._stackStyled && this._stack.shadowRoot) { // the stack has a title field of its own: the section has one already
      this._stackStyled = true;
      const style = document.createElement('style');
      style.textContent = 'ha-form { display: none; }';
      this._stack.shadowRoot.appendChild(style);
    }
  }

  // Keep the YAML short: no empty value, no option left at its default
  _changed(value) {
    const config = { ...value };
    if (!config.status_clickable) delete config.status_tap_action;
    else if (!config.status_tap_action) config.status_tap_action = { action: 'more-info' };
    delete config.status_clickable;
    CONFIRM_SWITCHES.forEach(([sw, key]) => {
      const act = config[key];
      if (act && typeof act === 'object') {
        if (config[sw] && !act.confirmation) config[key] = { ...act, confirmation: true };
        else if (!config[sw] && act.confirmation) {
          const { confirmation, ...rest } = act;
          config[key] = rest;
        }
      }
      delete config[sw];
    });
    // The choice "Show" is not an option: it sets or clears the options of the right of the title
    const mode = config.status_mode || 'none'; // the cross of the list clears it
    const switched = mode !== (this._mode || statusMode(this._config));
    this._mode = mode;
    delete config.status_mode;
    if (mode === 'state' || mode === 'select') {
      config.status_type = mode;
      delete config.status;
      if (mode === 'select') ['status_attribute', 'status_tap_action'].forEach((k) => delete config[k]);
    } else {
      ['status_type', 'status_entity', 'status_attribute'].forEach((k) => delete config[k]);
      if (mode === 'none') ['status', 'status_icon', 'status_color', 'status_tap_action'].forEach((k) => delete config[k]);
      else if (switched && mode === 'template') config.status = "[[[ return entity ? entity.state : ''; ]]]";
      else if (switched && TEMPLATE_RE.test(config.status || '')) delete config.status;
    }
    if (!config.collapsible) delete config.collapsed;
    Object.keys(config).forEach((k) => {
      if (config[k] === '' || config[k] == null) delete config[k];
    });
    if (config.separator === true) delete config.separator;
    if (config.collapsible === false) delete config.collapsible;
    if (config.collapsed === false) delete config.collapsed;
    this._config = config;
    this._update(); // a choice that changes no option (Nothing -> A text) must still show its fields
    this.dispatchEvent(new CustomEvent('config-changed', { bubbles: true, composed: true, detail: { config } }));
  }
}

// The card can be shipped by several sources (HACS, an integration): the first one loaded wins
if (!customElements.get('section-card')) {
  customElements.define('section-card', SectionCard);
  customElements.define('section-card-editor', SectionCardEditor);
  window.customCards = window.customCards || [];
  // The card picker reads this entry before any card gets hass: the language comes from the frontend storage
  let lang = navigator.language || 'en';
  try { lang = JSON.parse(localStorage.getItem('selectedLanguage')) || lang; } catch (e) { /* not set */ }
  const fr = String(lang).slice(0, 2) === 'fr';
  window.customCards.push({
    type: 'section-card',
    name: fr ? 'Carte Section' : 'Section card',
    description: fr
      ? "Un en-tête avec icône, titre et état à droite, un trait, puis vos cartes sur un fond transparent."
      : 'Header with icon, title and status, a separator, then any cards with a transparent background.',
    preview: true,
    documentationURL: 'https://github.com/noiwid/section-card',
  });
  console.info('%c SECTION-CARD %c ' + VERSION + ' ', 'color: white; background: #3f51b5; font-weight: bold;', 'color: #3f51b5; background: white; font-weight: bold;');
}
