import { useEffect, useState } from 'react'
import AcademicUnitPicker from './AcademicUnitPicker'
import { WEEKDAYS } from '../../utils/roomAccess.js'
import './RoomAccess.css'

export default function RoomAccessFields({ record, loadAcademicUnits }) {
  const [catalog, setCatalog] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [allDay, setAllDay] = useState(() => record?.ends_at?.slice(0, 5) === '24:00' && record?.starts_at?.slice(0, 5) === '00:00')

  useEffect(() => {
    let active = true
    loadAcademicUnits().then(units => {
      if (active) setCatalog({ units, attempt })
    }).catch(() => {
      if (active) setCatalog({ units: [], attempt })
    })
    return () => { active = false }
  }, [loadAcademicUnits, attempt])

  const units = catalog?.attempt === attempt ? catalog.units : null
  return (
    <>
      <fieldset className="room-access-fieldset">
        <legend>利用できる所属 *</legend>
        {units === null ? <p role="status">所属を読み込み中…</p>
          : units.length ? (
            <AcademicUnitPicker units={units} initialSelection={record?.academic_unit_ids} />
          ) : (
            <>
              <p className="review-error" role="alert">所属一覧を取得できませんでした。</p>
              <button className="review-back" type="button" onClick={() => setAttempt(value => value + 1)}>再試行</button>
            </>
          )}
      </fieldset>
      <fieldset className="room-access-fieldset">
        <legend>利用できる曜日 *</legend>
        <div className="room-access-weekdays">
          {WEEKDAYS.map((day, index) => (
            <label key={day} className="room-access-option">
              <input name="weekday" type="checkbox" value={index + 1} defaultChecked={record?.weekdays.includes(index + 1)} />
              {day}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="room-access-fieldset">
        <legend>利用できる時間 *</legend>
        <label className="room-access-option">
          <input name="all_day" type="checkbox" checked={allDay} onChange={event => setAllDay(event.target.checked)} />
          終日
        </label>
        <div className="room-access-times" hidden={allDay}>
          <label>
            開始
            <input name="starts_at" type="time" required={!allDay} disabled={allDay} defaultValue={record?.starts_at.slice(0, 5)} />
          </label>
          <label>
            終了
            <input name="ends_at" type="time" required={!allDay} disabled={allDay} defaultValue={record?.ends_at.slice(0, 5)} />
          </label>
        </div>
      </fieldset>
    </>
  )
}
