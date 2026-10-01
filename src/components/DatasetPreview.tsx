import type { DatasetPreview } from '../shared/dataset'
import { formatBytes, formatCell, formatCount } from '../run/metrics'

const SOURCE_LABEL = { sample: 'Sample dataset', upload: 'Uploaded CSV', public_url: 'CSV from a link' } as const

export const DatasetPreviewCard = ({
  dataset,
  labelColumn,
  onLabelColumn,
  onChange,
}: {
  dataset: DatasetPreview
  labelColumn: string
  onLabelColumn: (column: string) => void
  onChange: () => void
}) => {
  const shown = dataset.previewRows.length
  return (
    <section className="card" aria-labelledby="dataset-heading">
      <header className="card-head">
        <div>
          <p className="eyebrow">{SOURCE_LABEL[dataset.sourceType]}</p>
          <h2 id="dataset-heading">{dataset.displayName}</h2>
          <p className="meta">
            {formatCount(dataset.acceptedRowCount)} rows · {dataset.columns.length} columns
            {dataset.byteSize > 0 ? ` · ${formatBytes(dataset.byteSize)}` : ''}
          </p>
        </div>
        <button className="button quiet" type="button" onClick={onChange}>Change dataset</button>
      </header>
      {dataset.validationWarnings.length > 0 && (
        <ul className="warnings" aria-label="Things we adjusted while reading the file">
          {dataset.validationWarnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Dataset preview">
        <table className="data-table">
          <thead>
            <tr>{dataset.columns.map((column) => (
              <th key={column.name} scope="col" className={`${column.inferredType === 'number' ? 'is-number' : ''}${column.name === labelColumn ? ' is-label' : ''}`}>
                {column.name}{column.name === labelColumn ? <span className="tag">held out</span> : null}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {dataset.previewRows.map((row, rowIndex) => (
              <tr key={rowIndex}>{dataset.columns.map((column, index) => (
                <td key={column.name} className={`${column.inferredType === 'number' ? 'is-number' : ''}${column.name === labelColumn ? ' is-label' : ''}`}>{formatCell(row[index])}</td>
              ))}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="meta table-caption">Showing the first {shown} of {formatCount(dataset.acceptedRowCount)} rows.</p>
      <div className="field label-field">
        <label htmlFor="label-column">Score against a column <span className="optional">optional</span></label>
        <select id="label-column" value={labelColumn} onChange={(event) => onLabelColumn(event.target.value)} disabled={dataset.columns.length < 2}>
          <option value="">None. Just classify.</option>
          {dataset.columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
        </select>
        <p className="hint">If your data already has the right answer in a column, pick it. Jev never sees that column; it is only used to score Jev’s answers.</p>
      </div>
      {dataset.attribution && (
        <p className="meta attribution">
          <a href={dataset.attribution.sourceUrl} target="_blank" rel="noreferrer">{dataset.attribution.label}</a>
          {' · '}
          <a href={dataset.attribution.licenseUrl} target="_blank" rel="noreferrer">{dataset.attribution.licenseLabel}</a>
        </p>
      )}
    </section>
  )
}
