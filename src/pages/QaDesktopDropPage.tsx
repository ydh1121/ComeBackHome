import { ImportPage } from './ImportPage';
import './qa-page.css';

export function QaDesktopDropPage() {
  return (
    <div className="qa-desktop-drop" data-route="/__qa/desktop-drop" data-page="DesktopDrop" data-state="desktop-drop-active">
      <ImportPage />
      <div className="drag-overlay show" aria-hidden="true">
        <div className="box"><b>여기에 놓기</b><span>엑셀 · 이미지 · 여러 파일</span></div>
      </div>
    </div>
  );
}
