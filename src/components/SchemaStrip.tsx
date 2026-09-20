import { inspectDatasetShape, schemaColumnLabel, schemaStripParts } from '../dataset/shape'
import type { DatasetPreview } from '../shared/dataset'

export const SchemaStrip = ({ dataset }: { dataset: DatasetPreview }) => {
  const shape = inspectDatasetShape(dataset.columns, dataset.previewRows)
  const summary = schemaStripParts(shape).join(' · ')
  const columns = shape.columns.slice(0, 18)
  return (
    <section className="schema-strip" aria-label="Dataset shape">
      <p className="schema-strip-summary">{summary}</p>
      <ul className="schema-strip-cols">
        {columns.map((column) => (
          <li key={column.name} className="schema-chip" data-role={column.role}>
            {schemaColumnLabel(column)}
          </li>
        ))}
        {shape.columns.length > columns.length ? (
          <li className="schema-chip is-more">+{shape.columns.length - columns.length}</li>
        ) : null}
      </ul>
    </section>
  )
}
