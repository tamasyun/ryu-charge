import { useEffect, useRef, useState } from 'react'
import { demoAccount } from '../../demo/account.js'

function readFields(form, mode, rooms) {
  const text = name => String(form.get(name) ?? '').trim()
  const number = name => text(name) === '' ? null : Number(text(name))
  const validNumber = (value, min, max) =>
    value === null || (Number.isInteger(value) && value >= min && value <= max)
  const location = text('location_detail')
  if (location.length > 300) return null
  if (mode === 'room') {
    const name = text('name')
    const floor = number('floor')
    if (!name || name.length > 80 || !validNumber(floor, -10, 40)) return null
    return { name, floor, location_detail: location }
  }

  const roomId = text('room_id')
  const ports = number('ac_ports')
  if (!location || !rooms.some(room => room.id === roomId) || !validNumber(ports, 0, 50)) return null
  return { room_id: roomId, location_detail: location, ac_ports: ports }
}

export default function BuildingDataForm({
  building, formMode, onFormModeChange, record, onSubmit, onCancel, saving,
}) {
  const [invalid, setInvalid] = useState(false)
  const titleRef = useRef(null)
  const recordId = record?.id
  const label = formMode === 'room' ? '教室' : 'コンセント'

  useEffect(() => {
    if (recordId) titleRef.current?.focus()
  }, [recordId])

  function handleSubmit(event) {
    event.preventDefault()
    if (saving) return
    const fields = readFields(new FormData(event.currentTarget), formMode, building.rooms)
    setInvalid(!fields)
    if (fields) onSubmit(fields)
  }

  return (
    <form className="add-form" onSubmit={handleSubmit} onChange={() => invalid && setInvalid(false)}>
      <h3 ref={titleRef} tabIndex={record ? -1 : undefined}>{record ? `${label}を編集` : 'データを追加'}</h3>
      {!record && (
        <>
          <label htmlFor="form-mode">追加するもの</label>
          <select id="form-mode" value={formMode} onChange={event => onFormModeChange(event.target.value)}>
            <option value="room">教室</option>
            <option value="outlet" disabled={!building.rooms.length}>コンセント</option>
          </select>
        </>
      )}

      {formMode === 'room' ? (
        <>
          <label htmlFor="room-name">教室名 *</label>
          <input id="room-name" name="name" defaultValue={record?.name} required maxLength="80" placeholder="例：A102教室" />
          <label htmlFor="room-floor">階数</label>
          <input id="room-floor" name="floor" defaultValue={record?.floor ?? ''} type="number" min="-10" max="40" step="1" placeholder="例：1" />
          <label htmlFor="room-location">場所の説明</label>
          <textarea id="room-location" name="location_detail" defaultValue={record?.location_detail} maxLength="300" rows="3" />
        </>
      ) : (
        <>
          <label htmlFor="outlet-room">教室 *</label>
          <select id="outlet-room" name="room_id" defaultValue={record?.room_id} required>
            {building.rooms.map(room => (
              <option key={room.id} value={room.id}>{room.name}</option>
            ))}
          </select>
          <label htmlFor="outlet-location">コンセントの位置 *</label>
          <textarea
            id="outlet-location" name="location_detail" defaultValue={record?.location_detail} required
            maxLength="300" rows="3" placeholder="例：窓際の机の下"
          />
          <label htmlFor="outlet-ports">AC差込口数</label>
          <input id="outlet-ports" name="ac_ports" defaultValue={record?.ac_ports ?? ''} type="number" min="0" max="50" step="1" placeholder="例：2" />
        </>
      )}
      <p className="form-note">
        * 必須項目。
        {!record && !demoAccount.isActive() && '登録した情報は他の利用者にも公開されます。'}
        {!record && formMode === 'room' && '教室は投稿から1週間、編集・削除できます。'}
      </p>
      {invalid && <p className="review-error" role="alert">{label}の入力内容を確認してください。</p>}
      <button type="submit" className="save-button" disabled={saving}>
        {saving ? '保存中...' : record ? '保存する' : '追加する'}
      </button>
      {onCancel && <button type="button" className="review-back" disabled={saving} onClick={onCancel}>キャンセル</button>}
    </form>
  )
}
