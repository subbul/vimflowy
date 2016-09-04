/* globals virtualDom, $ */
/* eslint-disable no-use-before-define */
// virtualDom = require 'virtual-dom'
import _ from 'lodash';

import * as constants from './constants';
import * as utils from './utils';
import logger from './logger';
import * as Plugins from './plugins';
import * as Modes from './modes';

/* eslint-disable no-unused-vars */
import React from 'react';
/* eslint-enable no-unused-vars */
import ReactDOM from 'react-dom';

const MODES = Modes.modes;
const { NORMAL_MODE_TYPE } = Modes;
const { INSERT_MODE_TYPE } = Modes;
const MODE_TYPES = Modes.types;

// TODO: move mode-specific logic into mode render functions

const containerDivID = id => `node-${id}`;

const rowDivID = id => `node-${id}-row`;

const childrenDivID = id => `node-${id}-children`;

function getCursorClass(cursorBetween) {
  if (cursorBetween) {
    return 'theme-cursor-insert';
  } else {
    return 'theme-cursor';
  }
};

function renderReactLine(lineData, options = {}) {
  if (options.cursors === undefined) { options.cursors = {}; }
  if (options.highlights === undefined) { options.highlights = {}; }

  const results = [];

  // ideally this takes up space but is unselectable (uncopyable)
  const cursorChar = ' ';

  let line = [];

  // add cursor if at end
  // NOTE: this doesn't seem to work for the breadcrumbs, e.g. try visual selecting word at end
  if (lineData.length in options.cursors) {
    lineData.push({char: cursorChar});
  }

  if (lineData.length === 0) {
    return results;
  }

  for (let i = 0; i < lineData.length; i++) {
    const obj = lineData[i];
    const info = {
      column: i
    };
    const renderOptions = {};

    constants.text_properties.forEach((property) => {
      if (obj[property]) {
        renderOptions[property] = true;
      }
    });

    let x = obj.char;

    if (obj.char === '\n') {
      // tricky logic for rendering new lines within a bullet
      // (copies correctly, works when cursor is on the newline itself)
      x = '';
      info.break = true;
      if (i in options.cursors) {
        x = cursorChar + x;
      }
    }

    if (i in options.cursors) {
      renderOptions.cursor = true;
    } else if (i in options.highlights) {
      renderOptions.highlight = true;
    }

    info.char = x;
    info.renderOptions = renderOptions;

    line.push(info);
  }

  // collect set of words, { word: word, start: start, end: end }
  let word_chars = [];
  let word_start = 0;


  const newLineData = lineData.concat([{char: ' '}]);
  for (let i = 0; i < newLineData.length; i++) { // to make end condition easier
    // TODO  or (utils.isPunctuation obj.char)
    // problem is URLs have dots in them...
    const obj = newLineData[i];
    if (utils.isWhitespace(obj.char)) {
      if (i !== word_start) {
        const word_info = {
          word: word_chars.join(''),
          start: word_start,
          end: i - 1
        };
        if (options.wordHook) {
          line = options.wordHook(line, word_info);
        }
        if (utils.isLink(word_info.word)) {
          for (let j = word_info.start; j <= word_info.end; j++) {
            line[j].renderOptions.type = 'a';
            line[j].renderOptions.href = word_info.word;
          }
        }
      }
      word_start = i + 1;
      word_chars = [];
    } else {
      word_chars.push(obj.char);
    }
  }

  if (options.lineHook) {
    line = options.lineHook(line);
  }

  const renderSpec = [];
  // Normally, we collect things of the same type and render them in one div
  // If there are column-specific handlers, however, we must break up the div to handle
  // separate click events
  if (options.charclick) {
    line.forEach((x) => {
      x.renderOptions.text = x.char;
      if (!x.renderOptions.href) {
        x.renderOptions.onclick = options.charclick.bind(this, x.column);
      }
      renderSpec.push(x.renderOptions);
      if (x.break) {
        renderSpec.push({type: 'div'});
      }
    });
  } else {
    let acc = [];
    let renderOptions = {};

    const flush = function() {
      if (acc.length) {
        renderOptions.text = acc.join('');
        renderSpec.push(renderOptions);
        acc = [];
      }
      renderOptions = {};
    };

    // collect line into groups to render
    line.forEach((x) => {
      if (JSON.stringify(x.renderOptions) === JSON.stringify(renderOptions)) {
        acc.push(x.char);
      } else {
        flush();
        acc.push(x.char);
        ({ renderOptions } = x);
      }

      if (x.break) {
        flush();
        renderSpec.push({type: 'div'});
      }
    });
    flush();
  }

  for (let i2 = 0; i2 < renderSpec.length; i2++) {
    const spec = renderSpec[i2];
    const classes = spec.classes || [];
    const type = spec.type || 'span';
    if (type === 'a') {
      classes.push('theme-text-link');
    }

    // make sure .bold, .italic, .strikethrough, .underline correspond to the text properties
    constants.text_properties.forEach((property) => {
      if (spec[property]) {
        classes.push(property);
      }
    });

    if (spec.cursor) {
      classes.push(getCursorClass(options.cursorBetween));
    }
    if (spec.highlight) {
      classes.push('theme-bg-highlight');
    }

    results.push(
      <type
        className={classes.join(' ')}
        href={spec.href}
        onMouseover={options.linemouseover}
        onClick={spec.onclick}
      >
        {spec.text}
      </type>
    );
  }

  return results;
};

export function virtualRenderReactLine(session, path, options = {}) {
  const lineData = session.document.getLine(path.row);
  let cursors = {};
  const highlights = {};

  if (path.is(session.cursor.path)) {
    cursors[session.cursor.col] = true;

    if (session.anchor && !session.lineSelect) {
      if (session.anchor.path && path.is(session.anchor.path)) {
        const start = Math.min(session.cursor.col, session.anchor.col);
        const end = Math.max(session.cursor.col, session.anchor.col);
        for (let j = start; j <= end; j++) {
          highlights[j] = true;
        }
      } else {
        logger.warn('Multiline not yet implemented');
      }
    }

    // TODO BRING BACK
    // cursors = session.applyHook('renderCursorsDict', cursors, { path });
  }

  const results = [];

  const lineoptions = {
    cursors,
    highlights,
    cursorBetween: options.cursorBetween
  };

  if (options.handle_clicks) {
    if (session.mode === MODES.NORMAL || session.mode === MODES.INSERT) {
      lineoptions.charclick = function(column, e) {
        session.cursor.setPosition(path, column);
        // assume they might click again
        renderSession(session, {handle_clicks: true});
        // prevent overall path click
        e.stopPropagation();
        return false;
      };
    }
  } else if (!options.no_clicks) {
    lineoptions.linemouseover = () => renderSession(session, {handle_clicks: true});
  }

  // TODO BRING BACK
  // lineoptions.wordHook = session.applyHook.bind(session, 'renderLineWordHook');
  // lineoptions.lineHook = session.applyHook.bind(session, 'renderLineTextOptions');

  let lineContents = renderReactLine(lineData, lineoptions);
  // TODO BRING BACK
  // lineContents = session.applyHook('renderLineContents', lineContents, { path });
  [].push.apply(results, lineContents);

  // TODO BRING BACK
  // const infoChildren = session.applyHook('renderInfoElements', [], { path });
  const infoChildren = [];

  const info = (
    <span className='node-info'>
      {infoChildren}
    </span>
  );
  results.push(info);

  // TODO BRING BACK
  // return session.applyHook('renderLineElements', results, { path });
  return results;
};


export function renderLine(lineData, options = {}) {
  if (options.cursors === undefined) { options.cursors = {}; }
  if (options.highlights === undefined) { options.highlights = {}; }

  const results = [];

  // ideally this takes up space but is unselectable (uncopyable)
  const cursorChar = ' ';

  let line = [];

  // add cursor if at end
  // NOTE: this doesn't seem to work for the breadcrumbs, e.g. try visual selecting word at end
  if (lineData.length in options.cursors) {
    lineData.push({char: cursorChar});
  }

  if (lineData.length === 0) {
    return results;
  }

  for (let i = 0; i < lineData.length; i++) {
    const obj = lineData[i];
    const info = {
      column: i
    };
    const renderOptions = {};

    constants.text_properties.forEach((property) => {
      if (obj[property]) {
        renderOptions[property] = true;
      }
    });

    let x = obj.char;

    if (obj.char === '\n') {
      // tricky logic for rendering new lines within a bullet
      // (copies correctly, works when cursor is on the newline itself)
      x = '';
      info.break = true;
      if (i in options.cursors) {
        x = cursorChar + x;
      }
    }

    if (i in options.cursors) {
      renderOptions.cursor = true;
    } else if (i in options.highlights) {
      renderOptions.highlight = true;
    }

    info.char = x;
    info.renderOptions = renderOptions;

    line.push(info);
  }

  // collect set of words, { word: word, start: start, end: end }
  let word_chars = [];
  let word_start = 0;


  const newLineData = lineData.concat([{char: ' '}]);
  for (let i = 0; i < newLineData.length; i++) { // to make end condition easier
    // TODO  or (utils.isPunctuation obj.char)
    // problem is URLs have dots in them...
    const obj = newLineData[i];
    if (utils.isWhitespace(obj.char)) {
      if (i !== word_start) {
        const word_info = {
          word: word_chars.join(''),
          start: word_start,
          end: i - 1
        };
        if (options.wordHook) {
          line = options.wordHook(line, word_info);
        }
        if (utils.isLink(word_info.word)) {
          for (let j = word_info.start; j <= word_info.end; j++) {
            line[j].renderOptions.type = 'a';
            line[j].renderOptions.href = word_info.word;
          }
        }
      }
      word_start = i + 1;
      word_chars = [];
    } else {
      word_chars.push(obj.char);
    }
  }

  if (options.lineHook) {
    line = options.lineHook(line);
  }

  const renderSpec = [];
  // Normally, we collect things of the same type and render them in one div
  // If there are column-specific handlers, however, we must break up the div to handle
  // separate click events
  if (options.charclick) {
    line.forEach((x) => {
      x.renderOptions.text = x.char;
      if (!x.renderOptions.href) {
        x.renderOptions.onclick = options.charclick.bind(this, x.column);
      }
      renderSpec.push(x.renderOptions);
      if (x.break) {
        renderSpec.push({type: 'div'});
      }
    });
  } else {
    let acc = [];
    let renderOptions = {};

    const flush = function() {
      if (acc.length) {
        renderOptions.text = acc.join('');
        renderSpec.push(renderOptions);
        acc = [];
      }
      renderOptions = {};
    };

    // collect line into groups to render
    line.forEach((x) => {
      if (JSON.stringify(x.renderOptions) === JSON.stringify(renderOptions)) {
        acc.push(x.char);
      } else {
        flush();
        acc.push(x.char);
        ({ renderOptions } = x);
      }

      if (x.break) {
        flush();
        renderSpec.push({type: 'div'});
      }
    });
    flush();
  }

  for (let i2 = 0; i2 < renderSpec.length; i2++) {
    const spec = renderSpec[i2];
    const classes = spec.classes || [];
    const type = spec.type || 'span';
    if (type === 'a') {
      classes.push('theme-text-link');
    }

    // make sure .bold, .italic, .strikethrough, .underline correspond to the text properties
    constants.text_properties.forEach((property) => {
      if (spec[property]) {
        classes.push(property);
      }
    });

    if (spec.cursor) {
      classes.push(getCursorClass(options.cursorBetween));
    }
    if (spec.highlight) {
      classes.push('theme-bg-highlight');
    }

    const divoptions = {};
    if (classes.length) {
      divoptions.className = (classes.join(' '));
    }
    if (spec.href) {
      divoptions.href = spec.href;
    }
    if (spec.onclick) {
      divoptions.onclick = spec.onclick;
    }
    if (options.linemouseover) {
      divoptions.onmouseover = options.linemouseover;
    }

    results.push(virtualDom.h(type, divoptions, spec.text));
  }

  return results;
};


export function renderSession(session, options = {}) {
  if (session.menu) {
    renderMenu(session.menu);
    return;
  }

  if (!session.vnode) {
    // TODO: stop attaching things to the session
    session.vtree = virtualRenderSession(session);
    session.vnode = virtualDom.create(session.vtree);
    session.mainDiv.empty();
    session.mainDiv.append(session.vnode);
    return;
  }

  options.cursorBetween = (Modes.getMode(session.mode)).metadata.hotkey_type === Modes.INSERT_MODE_TYPE;

  const t = Date.now();
  const vtree = virtualRenderSession(session, options);
  const patches = virtualDom.diff(session.vtree, vtree);
  session.vnode = virtualDom.patch(session.vnode, patches);
  session.vtree = vtree;
  logger.debug('Rendering: ', !!options.handle_clicks, (Date.now()-t));

  const cursorDiv = $(`.${getCursorClass(options.cursorBetween)}`, session.mainDiv)[0];
  if (cursorDiv) {
    session.scrollIntoView(cursorDiv);
  }

  clearTimeout(session.cursorBlinkTimeout);
  session.mainDiv.removeClass('animate-blink-cursor');
  session.cursorBlinkTimeout = setTimeout(() => session.mainDiv.addClass('animate-blink-cursor'), 500);

};

function virtualRenderSession(session, options = {}) {
  const crumbs = [];
  let path = session.viewRoot;
  while (!path.is(session.document.root)) {
    crumbs.push(path);
    path = path.parent;
  }

  const makeCrumb = function(path, isLast) {
    const m_options = {};
    if (session.mode === MODES.NORMAL && !isLast) {
      m_options.className = 'theme-text-link';
      m_options.onclick = async () => {
        await session.zoomInto(path);
        session.save();
        renderSession(session);
      };
    }
    let text;
    if (isLast) {
      text = virtualRenderLine(session, path, options);
    } else if (path.is(session.document.root)) {
      text = virtualDom.h('icon', {className: 'fa fa-home'});
    } else {
      text = session.document.getText(path.row).join('');
    }
    return virtualDom.h('span', { className: 'crumb' }, [
      virtualDom.h('span', m_options, [ text ])
    ]);
  };

  const crumbNodes = [];
  crumbNodes.push(makeCrumb(session.document.root));
  for (let i = crumbs.length - 1; i >= 0; i--) {
    path = crumbs[i];
    crumbNodes.push(makeCrumb(path, i===0));
  }

  const breadcrumbsNode = virtualDom.h('div', {
    id: 'breadcrumbs'
  }, crumbNodes);

  options.ignoreCollapse = true; // since we're the root, even if we're collapsed, we should render

  options.highlight_blocks = {};
  if (session.lineSelect) {
    // mirrors logic of finishes_visual_line in keyHandler.js
    const [parent, index1, index2] = session.getVisualLineSelections();
    session.document.getChildRange(parent, index1, index2).forEach((child) => {
      options.highlight_blocks[child.row] = true;
    });
  }

  let contentsNode;
  if (session.document.hasChildren(session.viewRoot.row)) {
    const contentsChildren = virtualRenderTree(session, session.viewRoot, options);
    contentsNode = virtualDom.h('div', {}, contentsChildren);
  } else {
    let message = 'Nothing here yet.';
    if (session.mode === MODES.NORMAL) {
      message += ' Press o to start adding content!';
    }
    contentsNode = virtualDom.h('div', {
      class: 'center',
      style: {
        'padding': '20px', 'font-size': '20px', 'opacity': '0.5'
      }
    }, message);
  }

  return virtualDom.h('div', {}, [breadcrumbsNode, contentsNode]);
};

const virtualRenderTree = function(session, parent, options = {}) {
  if ((!options.ignoreCollapse) && session.document.collapsed(parent.row)) {
    return;
  }

  const childrenNodes = [];

  session.document.getChildren(parent).forEach((path) => {
    const pathElements = [];

    if (session.document.isClone(path.row)) {
      const cloneIcon = virtualDom.h('i', { className: 'fa fa-clone bullet clone-icon', title: 'Cloned' });
      pathElements.push(cloneIcon);
    }

    const ancestry_str = JSON.stringify(path.getAncestry());

    let icon = 'fa-circle';
    if (session.document.hasChildren(path.row)) {
      icon = session.document.collapsed(path.row) ? 'fa-plus-circle' : 'fa-minus-circle';
    }

    const bulletOpts = {
      className: `fa ${icon} bullet`,
      attributes: {'data-id': path.row, 'data-ancestry': ancestry_str}
    };
    if (session.document.hasChildren(path.row)) {
      bulletOpts.style = {cursor: 'pointer'};
      bulletOpts.onclick = (function(path) {
        session.toggleBlockCollapsed(path.row);
        session.save();
        return renderSession(session);
      }).bind(this, path);
    }

    let bullet = virtualDom.h('i', bulletOpts);
    bullet = session.applyHook('renderBullet', bullet, { path });

    pathElements.push(bullet);

    const elLine = virtualDom.h('div', {
      id: rowDivID(path.row),
      className: 'node-text',
      // if clicking outside of text, but on the row, move cursor to the end of the row
      onclick:  (function(path) {
        let col = options.cursorBetween ? -1 : -2;
        session.cursor.setPosition(path, col);
        return renderSession(session);
      }).bind(this, path)
    }, (virtualRenderLine(session, path, options)));
    pathElements.push(elLine);

    options.ignoreCollapse = false;
    const children = virtualDom.h('div', {
      id: childrenDivID(path.row),
      className: 'node-children'
    }, (virtualRenderTree(session, path, options)));
    pathElements.push(children);

    let className = 'node';
    if (path.row in options.highlight_blocks) {
      className += ' theme-bg-highlight';
    }

    const postHookPathElements = session.applyHook('renderPathElements', pathElements, { path });

    const childNode = virtualDom.h('div', {
      id: containerDivID(path.row),
      className
    }, postHookPathElements);

    childrenNodes.push(childNode);
  });
  return childrenNodes;
};

export function virtualRenderLine(session, path, options = {}) {
  const lineData = session.document.getLine(path.row);
  let cursors = {};
  const highlights = {};

  if (path.is(session.cursor.path)) {
    cursors[session.cursor.col] = true;

    if (session.anchor && !session.lineSelect) {
      if (session.anchor.path && path.is(session.anchor.path)) {
        const start = Math.min(session.cursor.col, session.anchor.col);
        const end = Math.max(session.cursor.col, session.anchor.col);
        for (let j = start; j <= end; j++) {
          highlights[j] = true;
        }
      } else {
        logger.warn('Multiline not yet implemented');
      }
    }

    cursors = session.applyHook('renderCursorsDict', cursors, { path });
  }

  const results = [];

  const lineoptions = {
    cursors,
    highlights,
    cursorBetween: options.cursorBetween
  };

  if (options.handle_clicks) {
    if (session.mode === MODES.NORMAL || session.mode === MODES.INSERT) {
      lineoptions.charclick = function(column, e) {
        session.cursor.setPosition(path, column);
        // assume they might click again
        renderSession(session, {handle_clicks: true});
        // prevent overall path click
        e.stopPropagation();
        return false;
      };
    }
  } else if (!options.no_clicks) {
    lineoptions.linemouseover = () => renderSession(session, {handle_clicks: true});
  }

  lineoptions.wordHook = session.applyHook.bind(session, 'renderLineWordHook');
  lineoptions.lineHook = session.applyHook.bind(session, 'renderLineTextOptions');

  let lineContents = renderLine(lineData, lineoptions);
  lineContents = session.applyHook('renderLineContents', lineContents, { path });
  [].push.apply(results, lineContents);

  const infoChildren = session.applyHook('renderInfoElements', [], { path });
  const info = virtualDom.h('span', {
    className: 'node-info'
  }, infoChildren);
  results.push(info);

  return session.applyHook('renderLineElements', results, { path });
};

export function renderMenu(menu) {
  if (!menu.div) {
    return;
  }

  const searchBox = (
    <div className='searchBox theme-trim'>
      <i className='fa fa-search' style={{'margin-right': 10}}/>
      <span>
        {
          virtualRenderReactLine(
            menu.session, menu.session.cursor.path,
            {cursorBetween: true, no_clicks: true}
          )
        }
      </span>
    </div>
  );

  let searchResults;

  if (menu.results.length === 0) {
    let message = '';
    if (menu.session.curLineLength() === 0) {
      message = 'Type something to search!';
    } else {
      message = 'No results!  Try typing something else';
    }
    searchResults = (
      <div style={{fontSize: 20, opacity: 0.5}} className='center'>
        {message}
      </div>
    );
  } else {
    searchResults = menu.results.map((result, i) => {
      const selected = i === menu.selection;

      const renderOptions = result.renderOptions || {};
      let contents = renderReactLine(result.contents, renderOptions);
      // TODO BRING BACK
      // if (result.renderHook) {
      //   contents = result.renderHook(contents);
      // }

      const className = selected ? 'theme-bg-selection' : '';
      const icon = selected ? 'fa-arrow-circle-right' : 'fa-circle';
      return (
        <div style={{marginBottom: 10}} className={className}>
          <i className={`fa ${icon} bullet`} style={{marginRight: 20}}>
          </i>
          <span>
            {contents}
          </span>
        </div>
      );
    });
  }

  ReactDOM.render(
    <div>
      {searchBox}
      {searchResults}
    </div>
    ,
    menu.div[0]
  );

};

export function renderPlugins(pluginManager) {
  if (pluginManager.div === undefined) {
    return;
  }

  const pluginElements = Plugins.names().map(
    name => renderReactPlugin(pluginManager, name)
  );

  ReactDOM.render(
    (
      <table>
        <tr>
          <th className='plugin-name'>
            Plugin
          </th>
          <th className='plugin-description'>
            Description
          </th>
          <th className='plugin-version'>
            Version
          </th>
          <th className='plugin-author'>
            Author
          </th>
          <th className='plugin-status'>
            Status
          </th>
          <th className='plugin-actions'>
            Actions
          </th>
        </tr>
        {pluginElements}
      </table>
    ),
    pluginManager.div[0]
  );
};

const renderReactPlugin = function(pluginManager, name) {
  const status = pluginManager.getStatus(name);
  const actions = [];
  let button;
  if (status === Plugins.STATUSES.ENABLED) {
    button = (
      <div className='btn theme-trim'
        onClick={() => { return pluginManager.disable(name); }}
      >
        Disable
      </div>
    );
    actions.push(button);
  } else if (status === Plugins.STATUSES.DISABLED) {
    button = (
      <div className='btn theme-trim'
        onClick={() => { return pluginManager.enable(name); }}
      >
        Enable
      </div>
    );
    actions.push(button);
  }

  let color = 'inherit';
  if (status === Plugins.STATUSES.ENABLING || status === Plugins.STATUSES.DISABLING) {
    color = 'yellow';
  }
  if (status === Plugins.STATUSES.UNREGISTERED || status === Plugins.STATUSES.DISABLED) {
    color = 'red';
  } else if (status === Plugins.STATUSES.ENABLED) {
    color = 'green';
  }

  const plugin = Plugins.getPlugin(name) || {};
  return (
    <tr className='plugin theme-bg-secondary'>
      <td className='center theme-trim plugin-name'>
        { name }
      </td>
      <td className='theme-trim plugin-description' style={{fontSize: 12}}>
        { plugin.description || '' }
      </td>
      <td className='center theme-trim plugin-version'>
        { (plugin.version || '') + '' }
      </td>
      <td className='center theme-trim plugin-author' style={{fontSize: 12}}>
        { plugin.author || '' }
      </td>
      <td className='center theme-trim plugin-status'
        style={{boxShadow: `inset 0px 0px 0px 2px ${color}`}}>
        {status}
      </td>
      <td className='center theme-trim plugin-actions'>
        {actions}
      </td>
    </tr>
  );
};

//#####
// hotkeys
//#####
export function renderHotkeysTable(key_bindings) {
  [
    { mode_type: NORMAL_MODE_TYPE, onto: $('#hotkey-edit-normal') },
    { mode_type: INSERT_MODE_TYPE, onto: $('#hotkey-edit-insert') },
  ].forEach(({mode_type, onto}) => {
    const mode_defs = MODE_TYPES[mode_type].modes.map(
      mode => _.cloneDeep(key_bindings.definitions.actions_for_mode(mode))
    );
    ReactDOM.render(
      <div>
        <div className='tooltip' title={MODE_TYPES[mode_type].description}>
          {mode_type}
        </div>
        {
          buildTable(
            key_bindings,
            key_bindings.hotkeys[mode_type],
            _.extend.apply(this, mode_defs)
          )
        }
      </div>
      ,
      onto[0]
    );
  });
};

// build table to visualize hotkeys
const buildTable = function(key_bindings, keyMap, actions, helpMenu) {
  const buildTableContents = function(bindings, recursed=false) {
    const result = [];
    for (const k in bindings) {
      const v = bindings[k];
      let keys;
      if (k === 'MOTION') {
        if (recursed) {
          keys = ['<MOTION>'];
        } else {
          continue;
        }
      } else {
        keys = keyMap[k];
        if (!keys) {
          continue;
        }
      }

      if (keys.length === 0 && helpMenu) {
        continue;
      }

      const el = (
        <tr key={k}>
          <td key='keys'>
            { keys.join(' OR ') }
          </td>
          <td key='desc' style={{width: '100%'}}>
            { v.description }
            {
              (() => {
                if (typeof v.definition === 'object') {
                  return buildTableContents(v.definition, true);
                }
              })()
            }
          </td>
        </tr>
      );

      result.push(el);
    }
    return result;
  };

  return (
    <div>
      {
        (() => {
          return [
            {label: 'Actions', definitions: actions},
            {label: 'Motions', definitions: key_bindings.definitions.motions}
          ].map(({label, definitions}) => {
            return [
              <h5 style={{margin: '5px 10px'}}>
                {label}
              </h5>
              ,
              <table className='keybindings-table theme-bg-secondary'>
                <tbody>
                  {buildTableContents(definitions)}
                </tbody>
              </table>
            ];
          });
        })()
      }
    </div>
  );
};

export function renderModeTable(key_bindings, mode, onto) {
  ReactDOM.render(
    buildTable(
      key_bindings,
      key_bindings.keyMaps[mode],
      key_bindings.definitions.actions_for_mode(mode),
      true
    ),
    onto[0]
  );
};
