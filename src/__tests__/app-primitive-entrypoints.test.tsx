import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { Settings } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { AppCard, AppCardContent } from '../renderer/components/AppCard';
import { AppIcon, AppIconButton } from '../renderer/components/AppIcon';
import { AppInput, AppSearchInput } from '../renderer/components/AppInput';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableRow,
} from '../renderer/components/DataTable/DataTable';

function readComponentFile(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

function componentPathExists(relativePath: string) {
  return existsSync(resolve(process.cwd(), relativePath));
}

describe('app primitive entrypoints', () => {
  it('keeps product primitive entrypoints off legacy IOS component paths', () => {
    const appCardPrimitives = readComponentFile('src/renderer/components/AppCard/primitives.ts');
    const appInputPrimitives = readComponentFile('src/renderer/components/AppInput/primitives.ts');
    const appIconPrimitives = readComponentFile('src/renderer/components/AppIcon/primitives.ts');
    const dataTablePrimitives = readComponentFile(
      'src/renderer/components/DataTable/primitives.ts'
    );

    expect(appCardPrimitives).not.toContain('../IOSCard');
    expect(appInputPrimitives).not.toContain('../IOSInput');
    expect(appIconPrimitives).not.toContain('../IOSIcon');
    expect(dataTablePrimitives).not.toContain('../IOSTable');
  });

  it('keeps product primitive implementation files off legacy IOS implementation symbols', () => {
    const appCardImplementation = readComponentFile('src/renderer/components/AppCard/AppCard.tsx');
    const appInputImplementation = readComponentFile(
      'src/renderer/components/AppInput/AppInput.tsx'
    );
    const appSearchInputImplementation = readComponentFile(
      'src/renderer/components/AppInput/AppSearchInput.tsx'
    );
    const appIconImplementation = readComponentFile('src/renderer/components/AppIcon/AppIcon.tsx');
    const appIconButtonImplementation = readComponentFile(
      'src/renderer/components/AppIcon/AppIconButton.tsx'
    );
    const dataTableImplementation = readComponentFile(
      'src/renderer/components/DataTable/DataTablePrimitives.tsx'
    );

    expect(appCardImplementation).not.toContain('IOSCard');
    expect(appInputImplementation).not.toContain('IOSInput');
    expect(appSearchInputImplementation).not.toContain('IOSSearchInput');
    expect(appIconImplementation).not.toContain('IOSIcon');
    expect(appIconButtonImplementation).not.toContain('IOSIconButton');
    expect(dataTableImplementation).not.toContain('IOSTable');
  });

  it('removes legacy IOS component directories from the active renderer source tree', () => {
    expect(componentPathExists('src/renderer/components/IOSButton')).toBe(false);
    expect(componentPathExists('src/renderer/components/IOSCard')).toBe(false);
    expect(componentPathExists('src/renderer/components/IOSIcon')).toBe(false);
    expect(componentPathExists('src/renderer/components/IOSInput')).toBe(false);
    expect(componentPathExists('src/renderer/components/IOSModal')).toBe(false);
    expect(componentPathExists('src/renderer/components/IOSTable')).toBe(false);
  });

  it('keeps active test entrypoints and docs off legacy IOS naming', () => {
    const primitiveVisualRegression = readComponentFile(
      'src/__tests__/primitive-visual-regression.test.tsx'
    );
    const appShellRedesign = readComponentFile('src/__tests__/app-shell-redesign.test.tsx');
    const architectureDoc = readComponentFile('docs/ARCHITECTURE.md');
    const developmentDoc = readComponentFile('docs/DEVELOPMENT.md');
    const componentIndex = readComponentFile('src/renderer/components/FOLDER_INDEX.md');
    const testIndex = readComponentFile('src/__tests__/FOLDER_INDEX.md');
    const projectIndex = readComponentFile('PROJECT_INDEX.md');

    expect(primitiveVisualRegression).not.toContain('IOS');
    expect(appShellRedesign).not.toContain('IOS');
    expect(architectureDoc).not.toContain('IOS');
    expect(developmentDoc).not.toContain('IOS');
    expect(componentIndex).not.toContain('IOS');
    expect(testIndex).not.toContain('IOS');
    expect(projectIndex).not.toContain('IOS');
  });

  it('exposes working product primitive exports from the new entrypoints', () => {
    const { container } = render(
      <div>
        <AppCard>
          <AppCardContent>Card</AppCardContent>
        </AppCard>
        <AppInput placeholder="Input" />
        <AppSearchInput placeholder="Search" />
        <AppIcon icon={Settings} />
        <AppIconButton icon={Settings} label="Settings" />
        <DataTable>
          <DataTableBody>
            <DataTableRow>
              <DataTableCell>Cell</DataTableCell>
            </DataTableRow>
          </DataTableBody>
        </DataTable>
      </div>
    );

    expect(container.querySelector('input[placeholder="Input"]')).toBeTruthy();
    expect(container.querySelector('input[placeholder="Search"]')).toBeTruthy();
    expect(container.querySelector('.data-table')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
