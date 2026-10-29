import * as assert from 'assert';
import { ValidationService } from '../../../../src/application/services/ValidationService';
import { CanDatabase } from '../../../../src/core/models/database/CanDatabase';
import { Message } from '../../../../src/core/models/database/Message';
import { DiagnosticSeverity } from '../../../../src/core/types';
import { DbcParser } from '../../../../src/infrastructure/parsers/dbc/DbcParser';

suite('ValidationService — CAN FD DLC checks', () => {
    let service: ValidationService;
    let db: CanDatabase;

    setup(() => {
        service = new ValidationService();
        db = new CanDatabase();
    });

    test('passes for classic CAN message with DLC = 8', () => {
        db.messages.push(new Message({ id: 0x100, name: 'Msg', dlc: 8 }));
        const diags = service.validate(db);
        const dlcErrors = diags.filter(
            (d) => d.path?.includes('dlc') && d.severity === DiagnosticSeverity.Error,
        );
        assert.strictEqual(dlcErrors.length, 0);
    });

    test('errors for classic CAN message with DLC = 9', () => {
        db.messages.push(new Message({ id: 0x100, name: 'Msg', dlc: 9 }));
        const diags = service.validate(db);
        const dlcErrors = diags.filter(
            (d) => d.path?.includes('dlc') && d.severity === DiagnosticSeverity.Error,
        );
        assert.ok(dlcErrors.length > 0, 'should error for classic DLC > 8');
    });

    test('passes for CAN FD message with DLC = 64', () => {
        db.messages.push(new Message({ id: 0x200, name: 'FdMsg', dlc: 64, isFd: true }));
        const diags = service.validate(db);
        const dlcErrors = diags.filter(
            (d) => d.path?.includes('dlc') && d.severity === DiagnosticSeverity.Error,
        );
        assert.strictEqual(dlcErrors.length, 0);
    });

    test('errors for CAN FD message with DLC > 64', () => {
        db.messages.push(new Message({ id: 0x200, name: 'FdMsg', dlc: 65, isFd: true }));
        const diags = service.validate(db);
        const dlcErrors = diags.filter(
            (d) => d.path?.includes('dlc') && d.severity === DiagnosticSeverity.Error,
        );
        assert.ok(dlcErrors.length > 0, 'should error for FD DLC > 64');
    });

    test('warns for CAN FD message with non-canonical DLC (e.g. 10)', () => {
        db.messages.push(new Message({ id: 0x200, name: 'FdMsg', dlc: 10, isFd: true }));
        const diags = service.validate(db);
        const dlcWarnings = diags.filter(
            (d) => d.path?.includes('dlc') && d.severity === DiagnosticSeverity.Warning,
        );
        assert.ok(dlcWarnings.length > 0, 'should warn for non-canonical FD DLC');
    });
});

suite('ValidationService — signal payload and extended ID checks', () => {
    let service: ValidationService;

    setup(() => {
        service = new ValidationService();
    });

    /** Diagnostics for a one-message DBC with a single signal. */
    function validate(messageId: number, dlc: number, signal: string) {
        const dbc = `VERSION ""\n\nBU_: ECU\n\nBO_ ${messageId} Msg: ${dlc} ECU\n SG_ ${signal} [0|65535] "" ECU\n`;
        return service.validate(new DbcParser().parse(dbc));
    }

    const payloadErrors = (diags: ReturnType<ValidationService['validate']>) =>
        diags.filter((d) => d.message.includes('extends beyond message payload'));

    test('Motorola signal filling the whole payload is valid (7|16@0 in DLC 2)', () => {
        assert.strictEqual(payloadErrors(validate(209, 2, 'Speed : 7|16@0+ (0.01,0)')).length, 0);
    });

    test('Motorola signal in the last byte of DLC 8 is valid (63|8@0)', () => {
        assert.strictEqual(payloadErrors(validate(209, 8, 'Last : 63|8@0+ (1,0)')).length, 0);
    });

    test('Motorola signal running past the payload is an error (15|16@0 in DLC 2)', () => {
        assert.strictEqual(payloadErrors(validate(209, 2, 'Speed : 15|16@0+ (1,0)')).length, 1);
    });

    test('Intel signal filling the payload is valid (0|16@1 in DLC 2)', () => {
        assert.strictEqual(payloadErrors(validate(209, 2, 'Speed : 0|16@1+ (1,0)')).length, 0);
    });

    test('Intel signal past the payload is still an error (8|16@1 in DLC 2)', () => {
        assert.strictEqual(payloadErrors(validate(209, 2, 'Speed : 8|16@1+ (1,0)')).length, 1);
    });

    test('extended ID stored with the DBC bit-31 flag is valid (0x892A3F65)', () => {
        const diags = validate(0x892a3f65, 2, 'Raw : 7|16@0+ (1,0)');
        assert.strictEqual(diags.filter((d) => d.message.includes('out of valid range')).length, 0);
    });

    test('ID beyond 29 bits is still an error', () => {
        const diags = validate(0x40000000, 2, 'Raw : 7|16@0+ (1,0)');
        assert.strictEqual(diags.filter((d) => d.message.includes('out of valid range')).length, 1);
    });
});
