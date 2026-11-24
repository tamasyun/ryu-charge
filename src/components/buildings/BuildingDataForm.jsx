import { useEffect, useRef, useState } from 'react'
import { demoAccount } from '../../demo/account.js'
import { readRoomAccessFields } from '../../utils/roomAccess.js'
import RoomAccessFields from './RoomAccessFields'

function readFields(form, mode, rooms) {
  const text = name => String(form.get(name) ?? '').trim()
  const number = name => text(name) === '' ? null : Number(text(name))
  const validNumber = (value, min, max) =>
    value === null || (Number.isInteger(value) && value >= min && value <= max)
  if (mode === 'room') {
    const name = text('name')
    const floor = number('floor')
    const location = text('location_detail')
    if (!name || name.length > 80 || location.length > 300 || !validNumber(floor, -10, 40)) return null
    return { name, floor, location_detail: location }
  }

  const roomId = text('room_id')
  if (!rooms.some(room => room.id === roomId)) return null
  if (mode === 'room-access') return readRoomAccessFields(form, roomId)

  const location = text('location_detail')
  const ports = number('ac_ports')
  if (!location || location.length > 300 || !validNumber(ports, 0, 50)) return null
  return { room_id: roomId, location_detail: location, ac_ports: ports }
}

export default function BuildingDataForm({
  building, formMode, onFormModeChange, record, defaultRoomId, onSubmit, onCancel, saving, loadAcademicUnits,
  loadRegisteredRoomIds,
}) {
  const [invalid, setInvalid] = useState(false)
  const [availability, setAvailability] = useState(null)
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0)
  const titleRef = useRef(null)
  const recordId = record?.id
  const label = { room: '教室', 'room-access': '教室の情報', outlet: 'コンセント' }[formMode]
  const isRoomAccess = formMode === 'room-access'
  const addingRoomAccess = isRoomAccess && !record
  const roomIdsKey = JSON.stringify(building.rooms.map(room => room.id))
  const roomAvailability = availability?.roomIdsKey === roomIdsKey ? availability : null
  const checking = addingRoomAccess && roomAvailability?.attempt !== availabilityAttempt
  const availableRooms = addingRoomAccess
    ? building.rooms.filter(room => roomAvailability?.registered && !roomAvailability.registered.has(room.id))
    : building.rooms
  const showFields = !addingRoomAccess || availableRooms.length > 0
  const preferredRoom = record?.room_id ?? defaultRoomId

  useEffect(() => {
    if (recordId) titleRef.current?.focus()
  }, [recordId])

  useEffect(() => {
    if (!addingRoomAccess) return
    let active = true
    loadRegisteredRoomIds(JSON.parse(roomIdsKey)).then(registered => {
      if (active) setAvailability({ roomIdsKey, attempt: availabilityAttempt, registered })
    }).catch(() => {
      if (active) setAvailability({ roomIdsKey, attempt: availabilityAttempt, registered: null })
    })
    return () => { active = false }
  }, [addingRoomAccess, roomIdsKey, availabilityAttempt, loadRegisteredRoomIds])

  function recheckRoomAccess() {
    setAvailabilityAttempt(value => value + 1)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (saving || checking || !showFields) return
    const fields = readFields(new FormData(event.currentTarget), formMode, availableRooms)
    setInvalid(!fields)
    if (fields && await onSubmit(fields) === false && addingRoomAccess) recheckRoomAccess()
  }

  return (
    <form className="add-form" onSubmit={handleSubmit} onChange={() => invalid && setInvalid(false)}>
      <h3 ref={titleRef} tabIndex={record ? -1 : undefined}>{record ? `${label}を編集` : 'データを追加'}</h3>
      {!record && (
        <>
          <label htmlFor="form-mode">追加するもの</label>
          <select id="form-mode" value={formMode} disabled={saving} onChange={event => {
            setInvalid(false)
            setAvailability(null)
            onFormModeChange(event.target.value)
          }}>
            <option value="room">教室</option>
            <option value="room-access" disabled={!building.rooms.length}>教室の情報</option>
            <option value="outlet" disabled={!building.rooms.length}>コンセント</option>
          </select>
        </>
      )}

      {checking && <p role="status">追加できる教室を確認中…</p>}
      {addingRoomAccess && !checking && !showFields && (
        roomAvailability?.registered ? <p>この建物の教室には利用条件が登録済みです。</p> : (
          <>
            <p className="review-error" role="alert">教室の登録状況を確認できませんでした。</p>
            <button type="button" className="review-back" onClick={recheckRoomAccess}>再試行</button>
          </>
        )
      )}

      {showFields && (formMode === 'room' ? (
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
          {isRoomAccess && record ? (
            <input type="hidden" name="room_id" value={record.room_id} />
          ) : (
            <>
              <label htmlFor="target-room">教室 *</label>
              <select
                id="target-room" name="room_id" required
                defaultValue={availableRooms.some(room => room.id === preferredRoom) ? preferredRoom : availableRooms[0]?.id}
              >
                {availableRooms.map(room => (
                  <option key={room.id} value={room.id}>{room.name}</option>
                ))}
              </select>
            </>
          )}
          {isRoomAccess ? <RoomAccessFields record={record} loadAcademicUnits={loadAcademicUnits} /> : (
            <>
              <label htmlFor="outlet-location">コンセントの位置 *</label>
              <textarea
                id="outlet-location" name="location_detail" defaultValue={record?.location_detail} required
                maxLength="300" rows="3" placeholder="例：窓際の机の下"
              />
              <label htmlFor="outlet-ports">AC差込口数</label>
              <input id="outlet-ports" name="ac_ports" defaultValue={record?.ac_ports ?? ''} type="number" min="0" max="50" step="1" placeholder="例：2" />
            </>
          )}
        </>
      ))}
      {showFields && (
        <p className="form-note">
          * 必須項目。
          {!record && !demoAccount.isActive() && '登録した情報は他の利用者にも公開されます。'}
          {!record && formMode === 'room' && '教室は投稿から1週間、編集・削除できます。'}
        </p>
      )}
      {invalid && (
        <p className="review-error" role="alert">
          {isRoomAccess ? '所属と曜日を選択し、終了時刻を開始時刻より後にしてください。' : `${label}の入力内容を確認してください。`}
        </p>
      )}
      {showFields && (
        <button type="submit" className="save-button" disabled={saving || checking}>
          {saving ? '保存中...' : record ? '保存する' : '追加する'}
        </button>
      )}
      {onCancel && <button type="button" className="review-back" disabled={saving} onClick={onCancel}>キャンセル</button>}
    </form>
  )
}
