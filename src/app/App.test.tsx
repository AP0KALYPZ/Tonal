import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { useAppStore } from '../state/store';

beforeEach(() => {
  useAppStore.getState().newProject();
});

describe('TONAL app shell', () => {
  it('shows the empty-state guidance and real project actions', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Your next drawing starts here.' })).toBeVisible();
    expect(
      screen.getByText('Drop a photo to build a precise graphite reference. Crops, tonal work and grids are never burned into your source.'),
    ).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Open photo' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Tonal development' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Drawing grid' })).toBeVisible();
  });

  it('changes independent grid counts through the stepper', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByLabelText('Columns')).toHaveValue('10');
    await user.click(screen.getByRole('button', { name: 'Increase Columns' }));
    await user.click(screen.getByRole('button', { name: 'Increase Rows' }));
    expect(useAppStore.getState().project.grid.columns).toBe(11);
    expect(useAppStore.getState().project.grid.rows).toBe(13);
    expect(screen.getByLabelText('Columns')).toHaveValue('11');
  });

  it('applies a graphite preset and undoes it from the toolbar', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Soft Portrait/ }));
    expect(useAppStore.getState().project.tone.shadows).toBe(18);
    expect(useAppStore.getState().project.tone.contrast).toBe(-8);

    const undo = screen.getByRole('button', { name: 'Undo (Ctrl+Z)' });
    expect(undo).toBeEnabled();
    await user.click(undo);
    expect(useAppStore.getState().project.tone.shadows).toBe(0);
    expect(useAppStore.getState().project.tone.contrast).toBe(0);
  });

  it('opens the project menu with recent-project support', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Untitled reference/ }));
    const menu = screen.getByRole('menu', { name: 'Project menu' });
    expect(within(menu).getByRole('menuitem', { name: /New project/ })).toBeVisible();
    expect(within(menu).getByText('Projects you open or save will appear here.')).toBeVisible();
    expect(within(menu).getByRole('menuitem', { name: /Keyboard shortcuts/ })).toBeVisible();
  });

  it('keeps export disabled until a photo exists', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('toggles grid visibility from the keyboard', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(useAppStore.getState().project.grid.visible).toBe(true);
    await user.keyboard('g');
    expect(useAppStore.getState().project.grid.visible).toBe(false);
    await user.keyboard('g');
    expect(useAppStore.getState().project.grid.visible).toBe(true);
  });
});
