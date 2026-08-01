import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { X } from "lucide-react";

type ButtonTone = "primary" | "secondary" | "danger" | "inline";

export function Button({ tone = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return <button className={`ac-button ac-button--${tone} ${className}`} {...props} />;
}

export function IconButton({ label, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className={`ac-icon-button ${className}`} aria-label={label} title={label} {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ac-input ${props.className ?? ""}`} {...props} />;
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return <label className="ac-checkbox"><input type="checkbox" {...props} />{label && <span>{label}</span>}</label>;
}

export function Switcher({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className="ac-switch"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

export function StatusBadge({ tone = "success", children }: { tone?: "success" | "warning" | "danger" | "neutral"; children: ReactNode }) {
  return <span className={`ac-status ac-status--${tone}`}>{children}</span>;
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <section className="ac-empty"><strong>{title}</strong><p>{text}</p>{action}</section>;
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="ac-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className={`ac-modal ${wide ? "ac-modal--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2><IconButton label="Закрыть" onClick={onClose}><X size={17} /></IconButton></header>
      {children}
    </section>
  </div>;
}

// Стабильные экспортируемые точки дизайн-системы. Расширяются без дублирования стилей страниц.
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={`ac-textarea ${props.className ?? ""}`} {...props} />;
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select className={`ac-select ${props.className ?? ""}`} {...props} />;
export const Radio = (props: InputHTMLAttributes<HTMLInputElement>) => <input type="radio" {...props} />;
export const FilePicker = (props: InputHTMLAttributes<HTMLInputElement>) => <input className="ac-file" type="file" {...props} />;
export const FormField = ({ label, children }: { label: string; children: ReactNode }) => <label className="ac-field"><span>{label}</span>{children}</label>;
export const Skeleton = () => <span className="ac-skeleton" aria-label="Загрузка" />;
export const Notification = ({ children }: { children: ReactNode }) => <div className="ac-notification">{children}</div>;
export const Toast = Notification;
export const Drawer = ({ children }: { children: ReactNode }) => <aside className="ac-drawer">{children}</aside>;
export const ConfirmDialog = Modal;
export const Stepper = ({ step, total }: { step: number; total: number }) => <div className="ac-stepper" aria-label={`Шаг ${step} из ${total}`}>{Array.from({ length: total }, (_, index) => <i key={index} className={index < step ? "is-active" : ""} />)}</div>;
export const Wizard = ({ children }: { children: ReactNode }) => <div className="ac-wizard">{children}</div>;
