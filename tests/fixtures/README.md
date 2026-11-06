写真処理のテスト用画像は、本作業で作成した赤・青の幾何パターンです。個人の写真は含みません。MITで利用できます。

- portrait.heic: 240×120の赤/青パターンをmacOS ImageIOでHEICへ保存。Orientation=6、テスト用撮影日時・GPSを設定。HEIFのirotにより120×240の縦向きでデコードされます。
- metadata.png: 同じパターンのPNGに、テスト文字列を含むtEXtチャンクを追加。
- oriented.png / oriented.webp: 有効なOrientation=6のEXIFを持つ、回転のブラウザ差を検証する同じパターン。
- metadata.webp: ChromeのCanvasで作成した2400×1200の透過つきパターンに、テスト文字列を含むEXIFチャンクを追加。

portrait.heicは実際のiPhone写真ではありません。公開iPhone写真の追加検証は、リポジトリへ含めずRYU_IPHONE_FIXTUREでローカルファイルを渡します。
