export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日']
export const ROOM_ACCESS_ALREADY_REGISTERED = 'この教室の情報はすでに登録されています。'

export function academicUnitTree(rows) {
  const nodes = new Map(rows.map(row => [row.id, { ...row, children: [] }]))
  const roots = []
  for (const node of nodes.values()) {
    const parent = nodes.get(node.parent_id)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  return roots
}

export function selectedAcademicUnits(roots, unitIds) {
  const selected = new Set(unitIds)
  function selection(node) {
    return selected.has(node.id) ? [node.id] : node.children.flatMap(selection)
  }
  return new Set(roots.flatMap(selection))
}

export function hasAcademicSelection(unit, selected) {
  return selected.has(unit.id) || unit.children.some(child => hasAcademicSelection(child, selected))
}

export function toggleAcademicSelection(selected, path) {
  const next = new Set(selected)
  const selectedAncestor = path.findIndex(unit => next.has(unit.id))

  if (selectedAncestor >= 0) {
    // 親から引き継いだ選択を外すときは、残る兄弟の所属を選択し直す。
    next.delete(path[selectedAncestor].id)
    for (let index = selectedAncestor; index < path.length - 1; index++) {
      for (const child of path[index].children) {
        if (child !== path[index + 1]) next.add(child.id)
      }
    }
  } else {
    function clearSelection(unit) {
      next.delete(unit.id)
      unit.children.forEach(clearSelection)
    }
    const unit = path.at(-1)
    clearSelection(unit)
    next.add(unit.id)
  }
  return next
}

export function academicUnitNames(rows) {
  const units = new Map(rows.map(row => [row.id, row]))
  function fullName(unit) {
    const parent = units.get(unit.parent_id)
    return parent ? `${fullName(parent)} / ${unit.name}` : unit.name
  }
  return new Map(rows.map(unit => [unit.id, fullName(unit)]))
}

export function readRoomAccessFields(form, roomId) {
  const weekdays = form.getAll('weekday').map(Number)
  const academic_unit_ids = form.getAll('academic_unit_id')
  const allDay = form.has('all_day')
  const starts_at = allDay ? '00:00' : form.get('starts_at')
  const ends_at = allDay ? '24:00' : form.get('ends_at')
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  if (!weekdays.length || weekdays.some(day => !WEEKDAYS[day - 1]) || !academic_unit_ids.length ||
      (!allDay && (!timePattern.test(starts_at) || !timePattern.test(ends_at) || starts_at >= ends_at))) {
    return null
  }
  return { room_id: roomId, academic_unit_ids, weekdays, starts_at, ends_at }
}
