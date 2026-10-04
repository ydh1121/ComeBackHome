import { useRef } from 'react';
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
  const inputRef = useRef<HTMLInputElement>(null);

  if (workflow.status === 'loading') {
    return <section className="import-page" data-page="ImportPage" data-state="LOADING"><div className="import-message">가져오기 정보를 불러오는 중</div></section>;
  }
  if (workflow.status === 'error' || !workflow.batch) {
    return <section className="import-page" data-page="ImportPage" data-state="ERROR"><div className="import-message">가져오기 정보를 불러오지 못했습니다.</div></section>;
  }

  const batch = workflow.batch;

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    await services.actions.importFiles.accept(Array.from(files).map(classifyFile));
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="import-page" data-route="/import" data-page="ImportPage" data-state="FILES_SELECTED">
      <h1 className="page-title">가져오기</h1>

      <button type="button" className="upload" onClick={() => inputRef.current?.click()}>
        <Icon name="upload" />
        <span><b>파일 선택</b><span className="meta">엑셀 또는 이미지</span></span>
      </button>
      <input
        ref={inputRef}
        className="import-file-input"
        type="file"
        accept=".xlsx,.xls,image/*"
        multiple
        onChange={(event) => onFiles(event.target.files)}
      />

      <div className="import-file-list">
        {batch.files.map((file) => (
          <div className="file-row" key={file.id}>
            <div className="file-icon file-icon-text">{file.kind === 'XLSX' ? '엑셀' : '이미지'}</div>
            <div className="grow">
              <b>{file.name}</b>
              {file.status === 'PARSING' ? (
                <div className="progress"><i style={{ width: Math.max(0, Math.min(100, file.progress)) + '%' }} /></div>
              ) : <div className="small">{statusLabel(file.status)}</div>}
            </div>
            {file.status === 'PARSING' ? <span className="small">{file.progress}%</span> : null}
          </div>
        ))}
      </div>

      <button
        type="button"
        className="cta"
        disabled={!batch.files.length}
        onClick={() => navigate('/import/' + encodeURIComponent(batch.id) + '/people')}
      >
        인식 결과 보기
      </button>
    </section>
  );
}
