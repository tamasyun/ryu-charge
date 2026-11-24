import { useState } from 'react'
import { academicUnitTree, hasAcademicSelection, selectedAcademicUnits, toggleAcademicSelection } from '../../utils/roomAccess.js'

function SelectionCheckbox({ label, checked, partial, onToggle }) {
  return (
    <label className="room-access-option">
      <input
        type="checkbox"
        checked={checked}
        ref={node => { if (node) node.indeterminate = partial }}
        onChange={onToggle}
      />
      {label}
    </label>
  )
}

function AcademicUnit({ unit, selected, onToggle, ancestors = [], inherited = false }) {
  const [expanded, setExpanded] = useState(false)
  const path = [...ancestors, unit]
  const checked = inherited || selected.has(unit.id)
  const partial = !checked && hasAcademicSelection(unit, selected)
  return (
    <li>
      <div className="academic-unit-row">
        <SelectionCheckbox label={unit.name} checked={checked} partial={partial} onToggle={() => onToggle(path)} />
        {unit.children.length > 0 && (
          <button
            className="academic-unit-expander"
            type="button"
            aria-expanded={expanded}
            aria-label={`${unit.name}を${expanded ? '閉じる' : '展開'}`}
            onClick={() => setExpanded(value => !value)}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
              <path d={expanded ? 'm4 10 4-4 4 4' : 'm4 6 4 4 4-4'} fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        )}
      </div>
      {expanded && (
        <ul className="academic-unit-children">
          {unit.children.map(child => (
            <AcademicUnit
              key={child.id} unit={child} selected={selected} onToggle={onToggle}
              ancestors={path} inherited={checked}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function AcademicUnitPicker({ units, initialSelection }) {
  const [roots] = useState(() => academicUnitTree(units))
  const [selected, setSelected] = useState(() => selectedAcademicUnits(roots, initialSelection ?? []))
  const allSelected = roots.every(root => selected.has(root.id))

  function toggle(path) {
    setSelected(current => toggleAcademicSelection(current, path))
  }

  return (
    <>
      <SelectionCheckbox
        label="全学部"
        checked={allSelected}
        partial={!allSelected && selected.size > 0}
        onToggle={() => setSelected(new Set(allSelected ? [] : roots.map(root => root.id)))}
      />
      <ul className="academic-unit-roots">
        {roots.map(unit => <AcademicUnit key={unit.id} unit={unit} selected={selected} onToggle={toggle} />)}
      </ul>
      {[...selected].map(id => (
        <input key={id} type="hidden" name="academic_unit_id" value={id} />
      ))}
    </>
  )
}
