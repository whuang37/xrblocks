import * as xb from 'xrblocks';
import * as THREE from 'three';

import {
  LanguageDetectorClient,
  languageName,
} from './LanguageDetectorClient.js';
import {GeminiLiveSource} from './SpeechSources.js';

const PLACEHOLDER =
  'Pinch the mic and say something in any language.\nEach utterance is detected separately.';
const MAX_UTTERANCES = 12;

export class LanguageDetectorDemo extends xb.Script {
  static dependencies = {camera: THREE.Camera};

  init({camera}) {
    this.camera = camera;
    this.detector = new LanguageDetectorClient();
    this.detector
      .load()
      .catch((e) => console.error('Language detector failed to load:', e));

    this.source = null;
    this.listening = false;
    this.utterances = []; // [{code, name, prob, text}]
    this.interim = '';

    this._buildUi();
  }

  _buildUi() {
    const panel = new xb.SpatialPanel({
      backgroundColor: '#101218e6',
      width: 1.8,
      height: 1.3,
    });
    this.add(panel);

    const grid = panel.addGrid();

    // Title bar.
    const titleRow = grid.addRow({weight: 0.13});
    this.titleText = titleRow.addText({
      text: 'Live Language Detector',
      fontColor: '#ffffff',
      fontSize: 0.055,
    });

    // Status bar (red dot when listening, hint otherwise).
    const statusRow = grid.addRow({weight: 0.07});
    this.statusText = statusRow.addText({
      text: 'Idle',
      fontColor: '#94a3b8',
      fontSize: 0.032,
    });

    // Spacer so the scroller's overflow can't bleed into the status/title.
    grid.addRow({weight: 0.06});

    // Utterance list (smooth scrolling).
    const listRow = grid.addRow({weight: 0.55});
    this.listView = new xb.ScrollingTroikaTextView({
      text: PLACEHOLDER,
      fontSize: 0.05,
      textAlign: 'left',
      fontColor: '#e7eaf2',
    });
    listRow.add(this.listView);

    // Spacer above controls.
    grid.addRow({weight: 0.06});

    // Controls row.
    const controlRow = grid.addRow({weight: 0.13});
    const controlGrid = controlRow.addPanel({showEdge: false}).addGrid();

    controlGrid.addCol({weight: 0.25});

    this.micButton = controlGrid.addCol({weight: 0.25}).addIconButton({
      text: 'mic',
      fontSize: 0.6,
      fontColor: '#ffffff',
    });
    this.micButton.onTriggered = () => this._toggleListening();

    controlGrid.addCol({weight: 0.05});

    this.clearButton = controlGrid.addCol({weight: 0.25}).addIconButton({
      text: 'delete',
      fontSize: 0.55,
      fontColor: '#ffffff',
    });
    this.clearButton.onTriggered = () => this._clear();

    controlGrid.addCol({weight: 0.2});

    panel.updateLayouts();
  }

  async _toggleListening() {
    if (this.listening) {
      await this._stop();
      this._setStatus('Stopped');
      this._setMicActive(false);
      return;
    }
    if (!GeminiLiveSource.isAvailable()) {
      this._setStatus('Gemini not enabled — add API key to keys.json');
      return;
    }
    const source = new GeminiLiveSource();
    source.onTranscript((text, isFinal) => this._onTranscript(text, isFinal));
    source.onError((err) => {
      console.error('Speech source error:', err);
      this._setStatus('Error: ' + (err?.message || err));
      this.listening = false;
      this.source = null;
      this._setMicActive(false);
    });
    try {
      await source.start();
      this.source = source;
      this.listening = true;
      this._setStatus('● Listening — speak any language');
      this._setMicActive(true);
    } catch (err) {
      console.error('Failed to start:', err);
      this._setStatus('Failed to start: ' + (err?.message || err));
    }
  }

  async _stop() {
    if (this.source) {
      await this.source.stop();
      this.source = null;
    }
    this.listening = false;
  }

  _clear() {
    this.utterances = [];
    this.interim = '';
    this.source?.reset?.();
    this._renderList();
  }

  _setStatus(message) {
    this.statusText.setText(message);
  }

  _setMicActive(active) {
    this.micButton.setText?.(active ? 'stop' : 'mic');
  }

  _onTranscript(text, isFinal) {
    if (!text) return;
    if (isFinal) {
      const lang = this._detect(text);
      this.utterances.push({...lang, text});
      if (this.utterances.length > MAX_UTTERANCES) this.utterances.shift();
      this.interim = '';
      this.interimLang = null;
      if (this.interimTimer) clearTimeout(this.interimTimer);
      this._renderList();
      this._renderInterim();
    } else {
      this.interim = text;
      // Debounce interim detection so we're not running it on every char.
      if (this.interimTimer) clearTimeout(this.interimTimer);
      this.interimTimer = setTimeout(() => {
        this.interimLang = this._detect(text);
        this._renderInterim();
      }, 200);
      this._renderInterim();
    }
  }

  _detect(text) {
    if (!this.detector?.detector || text.length < 4) {
      return {code: '??', name: '…', prob: 0};
    }
    const langs = this.detector.detect(text);
    if (!langs.length) return {code: '??', name: 'Unknown', prob: 0};
    const top = langs[0];
    return {
      code: top.languageCode.toUpperCase(),
      name: languageName(top.languageCode),
      prob: top.probability,
    };
  }

  _renderList() {
    if (!this.utterances.length) {
      this.listView.setText(PLACEHOLDER);
      return;
    }
    const fmt = (u) =>
      `[${u.code}] ${u.name} ${Math.round(u.prob * 100)}%  ${u.text}`;
    this.listView.setText(this.utterances.map(fmt).join('\n'));
  }

  _renderInterim() {
    if (!this.listening) return;
    if (!this.interim) {
      this._setStatus('● Listening — speak any language');
      return;
    }
    const live = this.interimLang;
    const tag = live
      ? `[${live.code}] ${live.name} ${Math.round(live.prob * 100)}%`
      : '[..] detecting…';
    this._setStatus(`${tag}  ${this.interim}`);
  }
}
