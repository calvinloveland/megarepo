// One stack of overlays, so "which panel is on screen" has a single answer.
//
// Before this, seventeen overlays each kept their own `hidden` flag, the shell
// toggled a `modal-open` body class at eleven call sites, and z-order was
// twenty-two hand-picked numbers in one stylesheet. Every bug that came out of
// that was the same shape: two things on screen at once, both live, neither
// owning the input — a settings button swallowed by the carrier's bar, a D-pad
// drawn over a race panel, a modal's close button behind a floating strip.
//
// The logic here is deliberately DOM-free: it tracks order and derives who owns
// input. A caller supplies two callbacks, so the stack can be tested without a
// browser.

export interface OverlaySpec {
  id: string;
  /**
   * A modal owns the screen: while one is open the world's own chrome steps
   * aside, Escape closes it, and nothing beneath it receives input.
   */
  modal: boolean;
  /** Show or hide the element. */
  setVisible: (visible: boolean) => void;
  /** Called once when the overlay leaves the stack, however it was closed. */
  onClose?: () => void;
}

export class OverlayStack {
  private readonly specs = new Map<string, OverlaySpec>();
  /** Open overlays, oldest first: the last one is on top and owns input. */
  private readonly open: string[] = [];

  constructor(
    private readonly onChange: (state: { modalOpen: boolean; topId: string | null }) => void = () => {},
  ) {}

  register(spec: OverlaySpec): void {
    this.specs.set(spec.id, spec);
    spec.setVisible(this.open.includes(spec.id));
  }

  isOpen(id: string): boolean {
    return this.open.includes(id);
  }

  /** The overlay that owns input, or null when the world has it. */
  topId(): string | null {
    return this.open.length > 0 ? this.open[this.open.length - 1]! : null;
  }

  /** True when a modal is up, so the world's chrome should step aside. */
  get modalOpen(): boolean {
    return this.open.some((id) => this.specs.get(id)?.modal);
  }

  open_(id: string): void {
    const spec = this.specs.get(id);
    if (!spec || this.open.includes(id)) {
      return;
    }
    this.open.push(id);
    spec.setVisible(true);
    this.changed();
  }

  close(id: string): void {
    const index = this.open.indexOf(id);
    if (index < 0) {
      return;
    }
    this.open.splice(index, 1);
    const spec = this.specs.get(id);
    spec?.setVisible(false);
    spec?.onClose?.();
    this.changed();
  }

  /**
   * Close whatever is on top. Returns true when something was closed, so a
   * key handler can let Escape fall through when nothing was.
   */
  closeTop(): boolean {
    const top = this.topId();
    if (!top) {
      return false;
    }
    this.close(top);
    return true;
  }

  /** Everything currently open, oldest first. */
  openIds(): string[] {
    return [...this.open];
  }

  private changed(): void {
    this.onChange({ modalOpen: this.modalOpen, topId: this.topId() });
  }
}
