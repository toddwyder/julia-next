'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EFFORTS, addPanelModel, effortById, isRoleOverride,
  removePanelModel, setEffort, setGroupModel, setRoleModel,
} from '../../../lib/roles.js';
import styles from './start.module.css';

const SAVED_LINE = 'Saved on this machine. A reload, or another card, keeps this choice.';

function ModelName({ model }) {
  if (!model) return <span className={styles.model}>Unknown model</span>;
  return <><span className={styles.model}>{model.name}</span> <span className={styles.price}>{model.price}</span></>;
}

function pickerName(group, role) {
  if (role) return `${group.name}: ${role.name}`;
  return `${group.name} group`;
}

// A group can be folded shut, so a change to its model hides the rows that moved. Say in one
// plain line what just moved, and what stayed where it was.
function describeChange(prev, next, groups, byId) {
  const name = id => byId.get(id)?.name ?? id;
  for (const group of groups) {
    const before = prev.groups[group.id];
    const after = next.groups[group.id];
    if (!before || !after) continue;
    if (group.panel) {
      const added = after.models.filter(id => !before.models.includes(id));
      const removed = before.models.filter(id => !after.models.includes(id));
      if (added.length) return `${added.map(name).join(', ')} added to ${group.name}.`;
      if (removed.length) return `${removed.map(name).join(', ')} removed from ${group.name}.`;
      const role = group.roles.find(item => (before.roles[item.id] ?? []).join() !== (after.roles[item.id] ?? []).join());
      if (role) return `${group.name}: ${role.name} now holds ${after.roles[role.id].map(name).join(', ')}.`;
      continue;
    }
    if (before.model !== after.model) {
      const count = group.roles.length;
      return `${group.name}: ${count === 1 ? 'its one role now uses' : `all ${count} roles now use`} ${name(after.model)}. Other groups stay as they are.`;
    }
    const role = group.roles.find(item => before.roles[item.id] !== after.roles[item.id]);
    if (role) {
      return after.roles[role.id] === after.model
        ? `${role.name} is back on the ${group.name} model, ${name(after.model)}.`
        : `${role.name} is set on its own to ${name(after.roles[role.id])}. The rest of ${group.name} stays on ${name(after.model)}.`;
    }
  }
  return '';
}

export default function StartScreen({ card, groups, models, initial, mainSession, shipping, saveDraft }) {
  const [choice, setChoice] = useState(initial);
  const [expanded, setExpanded] = useState('');
  const [picker, setPicker] = useState(null);
  const [info, setInfo] = useState('');
  const [notice, setNotice] = useState('');
  const [done, setDone] = useState('');
  const [ready, setReady] = useState(false);
  const [saveProblem, setSaveProblem] = useState('');

  // The page is drawn before this script runs, so for a moment the controls look usable but
  // drop every tap. Keep them off and say so until the handlers are attached.
  useEffect(() => setReady(true), []);

  const byId = useMemo(() => new Map(models.map(model => [model.id, model])), [models]);
  const effort = effortById(choice.effort);

  function change(makeNext) {
    let next;
    try {
      next = makeNext(choice);
    } catch (error) {
      setNotice(error.message);
      return;
    }
    setNotice('');
    setDone(describeChange(choice, next, groups, byId));
    setSaveProblem('');
    setChoice(next);
    saveDraft({ ...next, card, updatedAt: new Date().toISOString() })
      .catch(() => setSaveProblem('The choice could not be saved to disk. It is still on this screen, but a reload will lose it.'));
  }

  function choose(modelId) {
    const target = picker;
    setPicker(null);
    if (!target) return;
    const group = groups.find(item => item.id === target.groupId);
    if (!group) return;
    if (group.panel) change(current => addPanelModel(current, target.groupId, modelId, target.roleId));
    else if (target.roleId) change(current => setRoleModel(current, target.groupId, target.roleId, modelId));
    else change(current => setGroupModel(current, target.groupId, modelId));
  }

  function removeChip(group, roleId, modelId) {
    change(current => removePanelModel(current, group.id, modelId, roleId));
  }

  function chips(group, roleId, ids, label) {
    return <div className={styles.chips} role="group" aria-label={label}>
      {ids.map(id => <span className={styles.chip} key={id}>
        <ModelName model={byId.get(id)} />
        <button type="button" className={styles.chipCross} aria-label={`Remove ${byId.get(id)?.name ?? id} from ${label}`} disabled={!ready}
          onClick={() => removeChip(group, roleId, id)}>×</button>
      </span>)}
      <button type="button" className={styles.addChip} aria-label={`Add a model to ${label}`} disabled={!ready}
        onClick={() => setPicker({ groupId: group.id, roleId })}>+ Add</button>
    </div>;
  }

  return <>
    {ready ? null : <p className={styles.ready} role="status">
      Getting the controls ready. Wait a moment, then tap.
    </p>}
    <section className={styles.section} aria-labelledby="settings-heading">
      <h2 id="settings-heading">Settings</h2>
      <dl className={styles.summary}>
        <div className={styles.row}><dt>Main session</dt><dd><ModelName model={mainSession} /></dd></div>
        <div className={styles.row}><dt>Shipping</dt><dd><ModelName model={shipping} /></dd></div>
        <div className={styles.row}><dt>Effort</dt><dd>{effort.name}</dd></div>
      </dl>
    </section>

    <section className={styles.section} aria-labelledby="effort-heading">
      <h2 id="effort-heading">Effort</h2>
      <ul className={styles.efforts}>
        {EFFORTS.map(option => {
          const chosen = option.id === choice.effort;
          return <li key={option.id} className={chosen ? `${styles.effort} ${styles.chosen}` : styles.effort}>
            <button type="button" className={styles.effortPick} aria-pressed={chosen} disabled={!ready}
              onClick={() => change(current => setEffort(current, option.id))}>
              <span className={styles.brains} aria-hidden="true">{'🧠'.repeat(option.brains)}</span>
              <span className={styles.effortName}>{option.name}</span>
            </button>
            <button type="button" className={styles.infoButton} aria-label={`What ${option.name} means`} disabled={!ready}
              aria-expanded={info === option.id} onClick={() => setInfo(info === option.id ? '' : option.id)}>ⓘ</button>
            {info === option.id ? <p className={styles.info}>{option.info}</p> : null}
          </li>;
        })}
      </ul>
      <p className={styles.whyText}>How hard the models think. More brains is slower and costs more.</p>
    </section>

    <section className={styles.section} aria-labelledby="models-heading">
      <h2 id="models-heading">Models</h2>
      <p className={styles.hint}>Tap a model name to pick another from the weekly sweep. Tap the group name to see its roles.</p>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {done ? <p className={styles.done} role="status">{done}</p> : null}
      <ul className={styles.groups}>
        {groups.map(group => {
          const open = expanded === group.id;
          return <li key={group.id} className={styles.group}>
            <div className={styles.groupRow}>
              <button type="button" className={styles.groupName} aria-expanded={open} disabled={!ready}
                aria-controls={`roles-${group.id}`} onClick={() => setExpanded(open ? '' : group.id)}>
                <span className={styles.arrow} aria-hidden="true">{open ? '▾' : '▸'}</span>{group.name}
              </button>
              {group.panel
                ? chips(group, '', choice.groups[group.id].models, `${group.name} group`)
                : <button type="button" className={styles.modelButton} aria-label={`Change the ${group.name} group model`} disabled={!ready}
                  onClick={() => setPicker({ groupId: group.id, roleId: '' })}>
                  <ModelName model={byId.get(choice.groups[group.id].model)} />
                </button>}
            </div>
            {open ? <ul className={styles.roles} id={`roles-${group.id}`}>
              {group.roles.map(role => {
                const override = isRoleOverride(choice, group.id, role.id);
                const infoKey = `${group.id}:${role.id}`;
                return <li key={role.id} className={override ? `${styles.role} ${styles.roleOverride}` : styles.role}>
                  <span className={styles.roleName}>{role.name}</span>
                  <button type="button" className={styles.infoButton} aria-label={`What ${role.name} means`} disabled={!ready}
                    aria-expanded={info === infoKey} onClick={() => setInfo(info === infoKey ? '' : infoKey)}>ⓘ</button>
                  {group.panel
                    ? chips(group, role.id, choice.groups[group.id].roles[role.id], `${group.name}: ${role.name}`)
                    : <button type="button" className={styles.modelButton} aria-label={`Change the ${role.name} model`} disabled={!ready}
                      onClick={() => setPicker({ groupId: group.id, roleId: role.id })}>
                      <ModelName model={byId.get(choice.groups[group.id].roles[role.id])} />
                    </button>}
                  {override ? <span className={styles.override}>set on its own</span> : null}
                  {info === infoKey ? <p className={styles.info}>{role.explanation}</p> : null}
                </li>;
              })}
            </ul> : null}
          </li>;
        })}
      </ul>
      <p className={styles.saved}>{saveProblem || SAVED_LINE}</p>
    </section>

    {picker ? <ModelPicker label={pickerLabel(picker, groups)} models={models}
      current={currentPick(choice, picker, groups)}
      chosen={chosenIds(choice, picker, groups)}
      panel={Boolean(groups.find(group => group.id === picker.groupId)?.panel)}
      onClose={() => setPicker(null)} onChoose={choose} /> : null}
  </>;
}

function pickerLabel(picker, groups) {
  const group = groups.find(item => item.id === picker.groupId);
  if (!group) return 'Choose a model';
  const role = picker.roleId ? group.roles.find(item => item.id === picker.roleId) : null;
  return `Choose a model for ${pickerName(group, role)}`;
}

function currentPick(choice, picker, groups) {
  const group = groups.find(item => item.id === picker.groupId);
  if (!group || group.panel) return '';
  if (!group.roles.some(role => role.id === picker.roleId)) return '';
  return choice.groups[picker.groupId].roles[picker.roleId] ?? '';
}

function chosenIds(choice, picker, groups) {
  const group = groups.find(item => item.id === picker.groupId);
  if (!group?.panel) return [];
  if (picker.roleId) return choice.groups[picker.groupId].roles[picker.roleId] ?? [];
  return choice.groups[picker.groupId].models ?? [];
}

function ModelPicker({ label, models, current, chosen, panel, onClose, onChoose }) {
  const box = useRef(null);
  useEffect(() => {
    box.current?.focus();
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const accounts = [];
  for (const model of models) {
    const name = model.account ?? 'Other accounts';
    let bucket = accounts.find(item => item.name === name);
    if (!bucket) accounts.push(bucket = { name, models: [] });
    bucket.models.push(model);
  }
  return <div className={styles.pickerBackdrop} role="presentation" onClick={onClose}>
    <div className={styles.picker} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={box}
      onClick={event => event.stopPropagation()}>
      <div className={styles.pickerHead}>
        <h3>{label}</h3>
        <button type="button" className={styles.closePicker} aria-label="Close the model list" onClick={onClose}>Close</button>
      </div>
      <div className={styles.pickList}>
        {accounts.map(account => <section className={styles.pickGroup} key={account.name}
          aria-label={`${account.name} (${account.models.length})`}>
          <h4 className={styles.pickAccount}>{account.name} <span>{account.models.length}</span></h4>
          <ul className={styles.pickModels}>
            {account.models.map(model => {
              const picked = model.id === current;
              const added = panel && chosen.includes(model.id);
              return <li key={model.id}>
                <button type="button" className={picked ? `${styles.pickModel} ${styles.chosen}` : styles.pickModel}
                  aria-pressed={picked} onClick={() => onChoose(model.id)}>
                  <span className={styles.model}>{model.name}</span>
                  <span className={styles.price}>{model.price}</span>
                  {added ? <span className={styles.inPanel}>in this panel</span> : null}
                </button>
              </li>;
            })}
          </ul>
        </section>)}
      </div>
    </div>
  </div>;
}
