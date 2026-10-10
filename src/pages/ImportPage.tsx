import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { ImportInputFile } from '../application/contracts/actions';
import { useImportWorkflow } from '../features/import/useImportWorkflow';
import { Icon } from '../shared/components/Icon';
import './import-page.css';

function statusLabel(status: string): string {
  if (status === 'READY') return '인식 완료';
  if (status === 'ERROR') return '오류';
  if (status === 'PARSING') return '인식 중';
  return '대기 중';
}

function classifyFile(file: File): ImportInputFile {
  const image = file.type.startsWith('image/');
  return { kind: image ? 'IMAGE' : 'WORKBOOK', file };
}

export function ImportPage() {
  const navigate = useNavigate();
  const services = useApplicationServices();
  const workflow = useImportWorkflow();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const workbookInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  if (workflow.status === 'loading') {
    return <section className="import-page" data-page="ImportPage" data-state="LOADING"><div className="import-message">가져오기 정보를 불러오는 중</div></section>;
  }
  if (workflow.status === 'error') {
    return <section className="import-page" data-page="ImportPage" data-state="ERROR"><div className="import-message">가져오기 정보를 불러오지 못했습니다.</div></section>;
  }

  const batch = workflow.batch;
  const files = batch?.files ?? [];

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setImportError(null);
    try {
      const selected = Array.from(files);
      if (selected.some(file => !file.type.startsWith('image/') && !/\.xlsx$/i.test(file.name))) {
        throw new Error('엑셀 가져오기는 .xlsx 형식만 지원합니다. .xls 파일은 .xlsx로 저장한 뒤 선택해 주세요.');
      }
      await services.actions.importFiles.accept(selected.map(classifyFile));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '근무표를 인식하지 못했습니다.');
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = '';
      if (workbookInputRef.current) workbookInputRef.current.value = '';
    }
  };

  return (
    <section className="import-page" data-route="/import" data-page="ImportPage" data-state="FILES_SELECTED">
      <h1 className="page-title">가져오기</h1>

      <button type="button" className="upload" onClick={() => imageInputRef.current?.click()}>
        <Icon name="upload" />
        <span><b>근무표 이미지 추가</b><span className="meta">사진 · 스크린샷 여러 장 가능</span></span>
      </button>
      <input
        ref={imageInputRef}
        className="import-file-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => onFiles(event.target.files)}
      />

      <button type="button" className="import-workbook-button" onClick={() => workbookInputRef.current?.click()}>
        엑셀 파일 가져오기
      </button>
      <input
        ref={workbookInputRef}
        className="import-file-input"
        type="file"
        accept=".xlsx"
        multiple
        onChange={(event) => onFiles(event.target.files)}
      />

      {importError ? <div className="import-error" role="alert">{importError}</div> : null}

      <div className="import-file-list">
        {files.map((file) => (
          <div className="file-row" key={file.id}>
            <div className="file-icon file-icon-text">{file.kind === 'XLSX' ? '엑셀' : '이미지'}</div>
            <div className="grow">
              <b>{file.name}</b>
              {file.status === 'PARSING' ? (
                <div className="progress"><i style={{ width: Math.max(0, Math.min(100, file.progress)) + '%' }} /></div>
              ) : <div className="small">{statusLabel(file.status)}</div>}
              {file.status === 'ERROR' && file.message ? (
                <div className="import-file-diagnostic">{file.message}</div>
              ) : null}
            </div>
            {file.status === 'PARSING' ? <span className="small">{file.progress}%</span> : null}
          </div>
        ))}
      </div>

      <button
        type="button"
        className="cta"
        disabled={!batch || !files.some((file) => file.status === 'READY')}
        onClick={() => batch && navigate('/import/' + encodeURIComponent(batch.id) + '/people')}
      >
        인식 결과 보기
      </button>
    </section>
  );
}
