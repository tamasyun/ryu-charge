import { useId } from 'react'

export default function NicknameField({ value, onChange, disabled, autoFocus = false }) {
  const id = useId()
  return (
    <>
      <label htmlFor={id}>ニックネーム</label>
      <input
        id={id}
        type="text"
        name="nickname"
        autoComplete="nickname"
        placeholder="1〜20文字"
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
        required
        autoFocus={autoFocus}
      />
    </>
  )
}
