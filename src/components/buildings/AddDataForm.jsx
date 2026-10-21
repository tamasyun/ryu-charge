export default function AddDataForm({ building, formMode, onFormModeChange, onSubmit, saving }) {
  return (
    <form className="add-form" onSubmit={onSubmit}>
      <h3>データを追加</h3>
      <label htmlFor="form-mode">追加するもの</label>
      <select id="form-mode" value={formMode} onChange={event => onFormModeChange(event.target.value)}>
        <option value="room">教室</option>
        <option value="outlet" disabled={!building.rooms.length}>コンセント</option>
      </select>

      {formMode === 'room' ? (
        <>
          <label htmlFor="room-name">教室名 *</label>
          <input id="room-name" name="name" required maxLength="80" placeholder="例：A102教室" />
          <label htmlFor="room-floor">階数</label>
          <input id="room-floor" name="floor" type="number" min="-10" max="40" step="1" placeholder="例：1" />
          <label htmlFor="room-location">場所の説明</label>
          <textarea id="room-location" name="location_detail" maxLength="300" rows="3" />
        </>
      ) : (
        <>
          <label htmlFor="outlet-room">教室 *</label>
          <select id="outlet-room" name="room_id" required>
            {building.rooms.map(room => (
              <option key={room.id} value={room.id}>{room.name}</option>
            ))}
          </select>
          <label htmlFor="outlet-location">コンセントの位置 *</label>
          <textarea
            id="outlet-location" name="location_detail" required
            maxLength="300" rows="3" placeholder="例：窓際の机の下"
          />
          <label htmlFor="outlet-ports">AC差込口数</label>
          <input id="outlet-ports" name="ac_ports" type="number" min="0" max="50" step="1" placeholder="例：2" />
        </>
      )}
      <p className="form-note">* 必須項目。登録した情報は他の利用者にも公開されます。</p>
      <button type="submit" className="save-button" disabled={saving}>
        {saving ? '保存中...' : '追加する'}
      </button>
    </form>
  )
}
