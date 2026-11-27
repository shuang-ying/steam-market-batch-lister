export const PLUGIN_STYLES = `
/* Steam Market Batch Lister - Scoped Styles (.smbl-*) */
.smbl-trigger-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  margin-left: 10px;
  border: 1px solid #4e9bd6;
  border-radius: 3px;
  background: linear-gradient(135deg, #2b6cb0 0%, #1d4e89 100%);
  color: #ffffff !important;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  line-height: 1.4;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  transition: filter 0.15s ease, transform 0.1s ease;
  vertical-align: middle;
}
.smbl-trigger-btn:hover {
  filter: brightness(1.15);
}
.smbl-trigger-btn:active {
  transform: translateY(1px);
}

.smbl-fab {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 99990;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: 1px solid #66c0f4;
  border-radius: 6px;
  background: linear-gradient(135deg, #1b2838 0%, #2a475e 100%);
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
}
.smbl-fab:hover {
  border-color: #a4d7f5;
  filter: brightness(1.12);
}

.smbl-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99995;
  background: rgba(11, 16, 22, 0.62);
  display: none;
  align-items: center;
  justify-content: center;
  padding: 18px;
  box-sizing: border-box;
  font-family: "Motiva Sans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.smbl-backdrop.smbl-open {
  display: flex;
}

.smbl-panel {
  width: min(1320px, 97vw);
  height: min(88vh, 860px);
  background: #1b2838;
  color: #c7d5e0;
  border: 1px solid #3c5a75;
  border-radius: 6px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.72);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-size: 13px;
}

.smbl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(90deg, #171a21 0%, #223548 100%);
  border-bottom: 1px solid #2e475d;
  gap: 12px;
}
.smbl-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.smbl-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
  white-space: nowrap;
}
.smbl-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  background: #2a475e;
  color: #66c0f4;
  white-space: nowrap;
}
.smbl-badge-warn {
  background: rgba(217, 119, 6, 0.22);
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.45);
}
.smbl-badge-danger {
  background: rgba(220, 38, 38, 0.22);
  color: #f87171;
  border: 1px solid rgba(248, 113, 113, 0.45);
}
.smbl-badge-ok {
  background: rgba(34, 197, 94, 0.18);
  color: #86efac;
  border: 1px solid rgba(134, 239, 172, 0.35);
}

.smbl-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.smbl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 3px;
  border: 1px solid #3c5a75;
  background: #2a475e;
  color: #e5eef5;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.smbl-btn:hover:not(:disabled) {
  background: #365c7a;
  border-color: #66c0f4;
}
.smbl-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.smbl-btn-primary {
  background: linear-gradient(135deg, #47bfff 0%, #1a9fff 100%);
  border-color: #66c0f4;
  color: #0b1622;
}
.smbl-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #68cbff 0%, #34abff 100%);
}
.smbl-btn-success {
  background: linear-gradient(135deg, #75b022 0%, #588a1b 100%);
  border-color: #a4d007;
  color: #ffffff;
}
.smbl-btn-success:hover:not(:disabled) {
  background: linear-gradient(135deg, #8ed629 0%, #6aa621 100%);
}
.smbl-btn-danger {
  background: #8f2323;
  border-color: #d14545;
  color: #ffffff;
}
.smbl-btn-danger:hover:not(:disabled) {
  background: #b12c2c;
}
.smbl-btn-ghost {
  background: transparent;
  border-color: transparent;
  color: #9bb2c5;
}
.smbl-btn-ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}

.smbl-gamebar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: #16202d;
  border-bottom: 1px solid #26384a;
  overflow-x: auto;
}
.smbl-gametab {
  padding: 5px 11px;
  border-radius: 3px;
  border: 1px solid #2b4258;
  background: #1e2e3f;
  color: #9bb2c5;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.smbl-gametab:hover {
  color: #ffffff;
  border-color: #4f799e;
}
.smbl-gametab.smbl-active {
  background: #2d5578;
  border-color: #66c0f4;
  color: #ffffff;
  font-weight: 700;
}

.smbl-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 10px 16px;
  background: #1e2d3d;
  border-bottom: 1px solid #2a3f54;
}

.smbl-input,
.smbl-select {
  height: 30px;
  padding: 0 9px;
  border-radius: 3px;
  border: 1px solid #355069;
  background: #111b26;
  color: #e5eef5;
  font-size: 12px;
  box-sizing: border-box;
}
.smbl-input:focus,
.smbl-select:focus {
  outline: none;
  border-color: #66c0f4;
}
.smbl-search {
  width: 210px;
}

.smbl-strategy-group {
  display: inline-flex;
  border: 1px solid #355069;
  border-radius: 3px;
  overflow: hidden;
}
.smbl-strategy-btn {
  padding: 5px 10px;
  border: none;
  border-right: 1px solid #355069;
  background: #152230;
  color: #9bb2c5;
  font-size: 12px;
  cursor: pointer;
}
.smbl-strategy-btn:last-child {
  border-right: none;
}
.smbl-strategy-btn:hover {
  color: #ffffff;
  background: #1f3347;
}
.smbl-strategy-btn.smbl-active {
  background: #2a6395;
  color: #ffffff;
  font-weight: 700;
}

.smbl-check-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #b8c9d9;
  cursor: pointer;
  user-select: none;
}

.smbl-settings-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 7px 16px;
  background: #172330;
  border-bottom: 1px solid #26384a;
  font-size: 12px;
  color: #96adc2;
}
.smbl-custom-bar {
  display: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 8px 16px;
  background: #1d2f42;
  border-bottom: 1px solid #355777;
  font-size: 12px;
  color: #d6e4f0;
}
.smbl-custom-bar.smbl-visible {
  display: flex;
}
.smbl-custom-hint {
  color: #8fb4d4;
  font-size: 11.5px;
}
.smbl-mini-input {
  width: 68px;
  height: 24px;
  padding: 0 6px;
  border-radius: 3px;
  border: 1px solid #355069;
  background: #0f1822;
  color: #e5eef5;
  font-size: 12px;
}

.smbl-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.smbl-table-wrap {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: #15202b;
}

.smbl-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.smbl-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #1b2a3a;
  color: #8fa9bf;
  font-size: 11px;
  font-weight: 700;
  text-align: left;
  padding: 8px 8px;
  border-bottom: 1px solid #2e475d;
  white-space: nowrap;
}
.smbl-table tbody tr {
  border-bottom: 1px solid #1f3042;
  transition: background 0.1s ease;
}
.smbl-table tbody tr:hover {
  background: rgba(102, 192, 244, 0.06);
}
.smbl-table tbody tr.smbl-row-selected {
  background: rgba(45, 114, 178, 0.18);
}
.smbl-table tbody td {
  padding: 7px 8px;
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
}

.smbl-item-cell {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.smbl-item-icon {
  width: 40px;
  height: 40px;
  object-fit: contain;
  background: #101822;
  border: 1px solid #2b4258;
  border-radius: 3px;
  flex-shrink: 0;
}
.smbl-item-meta {
  min-width: 0;
  flex: 1;
}
.smbl-item-name {
  font-weight: 600;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.smbl-item-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: 11px;
  color: #7f98ad;
}

.smbl-qty-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.smbl-qty-input {
  width: 46px;
  height: 26px;
  padding: 0 4px;
  border-radius: 3px;
  border: 1px solid #355069;
  background: #0f1822;
  color: #ffffff;
  font-size: 12px;
  text-align: center;
  box-sizing: border-box;
}
.smbl-price-input {
  width: 78px;
  height: 26px;
  padding: 0 6px;
  border-radius: 3px;
  border: 1px solid #355069;
  background: #0f1822;
  color: #a4d007;
  font-weight: 600;
  font-size: 12px;
}
.smbl-price-input.smbl-manual {
  border-color: #fbbf24;
  color: #fde68a;
}
.smbl-cost-input {
  width: 68px;
  height: 26px;
  padding: 0 6px;
  border-radius: 3px;
  border: 1px solid #355069;
  background: #0f1822;
  color: #e5eef5;
  font-size: 12px;
}
.smbl-cost-input:focus {
  outline: none;
  border-color: #66c0f4;
}
.smbl-cny-sub {
  font-size: 11px;
  color: #8ba6be;
  margin-top: 2px;
  white-space: nowrap;
}
.smbl-ratio-good {
  color: #86efac;
  font-weight: 700;
}
.smbl-ratio-mid {
  color: #93c5fd;
  font-weight: 700;
}
.smbl-ratio-warn {
  color: #fbbf24;
  font-weight: 700;
}
.smbl-ratio-bad {
  color: #f87171;
  font-weight: 700;
}
.smbl-fx-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  background: #1e3a4c;
  color: #93e2ff;
  border: 1px solid #315c78;
  cursor: pointer;
  white-space: nowrap;
}
.smbl-fx-badge:hover {
  border-color: #66c0f4;
  background: #25485e;
}

.smbl-nav-tabs {
  display: inline-flex;
  border: 1px solid #355069;
  border-radius: 3px;
  overflow: hidden;
  margin-right: 4px;
}
.smbl-nav-tab {
  padding: 5px 11px;
  border: none;
  border-right: 1px solid #355069;
  background: #152230;
  color: #9bb2c5;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.smbl-nav-tab:last-child {
  border-right: none;
}
.smbl-nav-tab:hover {
  color: #ffffff;
  background: #1f3347;
}
.smbl-nav-tab.smbl-active {
  background: #2d5578;
  color: #ffffff;
}

.smbl-view {
  display: none;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
.smbl-view.smbl-view-active {
  display: flex;
}

.smbl-hist-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 10px 16px;
  background: #1e2d3d;
  border-bottom: 1px solid #2a3f54;
}
.smbl-hist-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 8px 16px;
  background: #16222f;
  border-bottom: 1px solid #26384a;
  font-size: 12.5px;
  color: #b8c9d9;
}
.smbl-hist-summary strong {
  color: #ffffff;
}
.smbl-hist-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 16px;
  background: #171a21;
  border-top: 1px solid #2e475d;
  font-size: 11.5px;
  color: #7f98ad;
}

.smbl-num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.smbl-price-sell {
  color: #66c0f4;
}
.smbl-price-buy {
  color: #fbbf24;
}
.smbl-price-net {
  color: #a4d007;
  font-weight: 700;
}
.smbl-muted {
  color: #71889c;
}

.smbl-log-pane {
  width: 250px;
  border-left: 1px solid #2b4258;
  background: #121b25;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.smbl-log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: #182533;
  border-bottom: 1px solid #26384a;
  font-size: 12px;
  font-weight: 700;
  color: #b8c9d9;
}
.smbl-log-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
  font-family: Consolas, "Cascadia Mono", monospace;
  font-size: 11px;
  line-height: 1.5;
}
.smbl-log-item {
  margin-bottom: 5px;
  word-break: break-word;
}
.smbl-log-info { color: #a7bed3; }
.smbl-log-ok { color: #86efac; }
.smbl-log-warn { color: #fbbf24; }
.smbl-log-err { color: #f87171; }

.smbl-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  background: #171a21;
  border-top: 1px solid #2e475d;
}
.smbl-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  font-size: 12.5px;
}
.smbl-summary strong {
  color: #ffffff;
}
.smbl-progress-wrap {
  width: 100%;
  display: none;
  flex-direction: column;
  gap: 5px;
}
.smbl-progress-wrap.smbl-visible {
  display: flex;
}
.smbl-progress-bar {
  width: 100%;
  height: 7px;
  border-radius: 4px;
  background: #243445;
  overflow: hidden;
}
.smbl-progress-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #47bfff 0%, #a4d007 100%);
  transition: width 0.2s ease;
}
.smbl-progress-text {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  color: #9bb2c5;
}

.smbl-empty {
  padding: 46px 20px;
  text-align: center;
  color: #8299ad;
  font-size: 13px;
}

/* Confirmation Modal */
.smbl-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(6, 10, 15, 0.75);
  display: none;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.smbl-modal-overlay.smbl-open {
  display: flex;
}
.smbl-modal {
  width: min(560px, 94vw);
  max-height: 82vh;
  background: #1b2838;
  border: 1px solid #4e7ca3;
  border-radius: 6px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #d2dfeb;
}
.smbl-modal-head {
  padding: 12px 16px;
  background: #171a21;
  border-bottom: 1px solid #2e475d;
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
}
.smbl-modal-body {
  padding: 14px 16px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.55;
}
.smbl-modal-list {
  margin-top: 10px;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid #2b4258;
  border-radius: 4px;
  background: #131e29;
  padding: 6px 10px;
  font-size: 12px;
}
.smbl-modal-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid #1d2d3d;
}
.smbl-modal-row:last-child {
  border-bottom: none;
}
.smbl-modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px;
  background: #171a21;
  border-top: 1px solid #2e475d;
}
`;
