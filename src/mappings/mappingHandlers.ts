import { SubstrateEvent, SubstrateExtrinsic } from "@subql/types";
import { Transfer } from "../types";
import { Balance } from "@polkadot/types/interfaces";
import { Account } from '../types/models/Account';
import { tokens } from '../helpers/token'

const DOT_REDENOMINATION_BLOCK = 1248328

async function ensureAccounts(accountIds: string[]): Promise<void> {
    for (const accountId of accountIds) {
        const account = await Account.get(accountId);
        if (!account) {
            await new Account(accountId).save();
        }
    }
}

function calculateFees(extrinsic: SubstrateExtrinsic): bigint {
    let depositFees = BigInt(0);
    let treasuryFees = BigInt(0);

    const eventRecordWithdraw = extrinsic.events.find((event) => {
        return event.event.method == "Withdraw" && event.event.section == "balances"
    })

    if (eventRecordWithdraw) {
        const {
            event: {
                data: [accountid, fee]
            }
        } = eventRecordWithdraw

        const extrinsicSigner = extrinsic.extrinsic.signer.toString()
        const withdrawAccountId = accountid.toString()

        return extrinsicSigner === withdrawAccountId ? (fee as Balance).toBigInt() : BigInt(0)
    }

    const eventRecordDeposit = extrinsic.events.find((event) => {
        return event.event.method == "Deposit" && event.event.section == "balances"
    })

    const eventRecordTreasury = extrinsic.events.find((event) => {
        return event.event.method == "Deposit" && event.event.section == "treasury"
    })

    if(eventRecordDeposit) {
        const {event: {data: [, fee]}}= eventRecordDeposit

        depositFees = (fee as Balance).toBigInt()
    }
    if(eventRecordTreasury) {
        const {event: {data: [fee]}}= eventRecordTreasury

        treasuryFees = (fee as Balance).toBigInt()
    }

    const totalFees = depositFees + treasuryFees

    return totalFees
}


export async function handleTransfer(event: SubstrateEvent): Promise<void> {
    const {
        event: {
            data: [from, to, amount],
        },
    } = event;
    
    const blockNo = event.block.block.header.number.toNumber();
    const decimals = blockNo >= DOT_REDENOMINATION_BLOCK ?  BigInt("1" + "0".repeat(tokens.DOT.decimals.new)) :  BigInt("1" + "0".repeat(tokens.DOT.decimals.old))
    const transformedAmount = (amount as Balance).toBigInt();
    const extrinsicHash = event.extrinsic?.extrinsic.hash.toString();
    const timestamp = event.extrinsic ? event.extrinsic.block.timestamp : new Date();
    const transferInfo = new Transfer(`${blockNo}-${event.idx}`);
    const isSuccess = event.extrinsic ? event.extrinsic.success : false;

    await ensureAccounts([from.toString(), to.toString()]);

    transferInfo.token = tokens.DOT.name;
    transferInfo.fromId = from.toString();
    transferInfo.toId = to.toString();
    transferInfo.timestamp = timestamp;
    transferInfo.extrinsicHash = extrinsicHash;
    transferInfo.amount = transformedAmount;
    transferInfo.fees = event.extrinsic ? calculateFees(event.extrinsic) : BigInt(0)
    transferInfo.status = isSuccess;
    transferInfo.decimals = decimals;
    
    await transferInfo.save();
}


export async function handleFailedTransfers(extrinsic: SubstrateExtrinsic): Promise<void> {
    const { isSigned } = extrinsic.extrinsic;

    if(isSigned){
        if(extrinsic.success){
            return null
        }

        const method = extrinsic.extrinsic.method;
        const events = ["transfer", "transferKeepAlive"]

        if(method.section == "balances" && events.includes(method.method)){
            const [to, amount] = method.args;
            const from = extrinsic.extrinsic.signer;
            const blockNo = extrinsic.block.block.header.number.toNumber();
            const decimals = blockNo >= DOT_REDENOMINATION_BLOCK ?  BigInt("1" + "0".repeat(tokens.DOT.decimals.new)) :  BigInt("1" + "0".repeat(tokens.DOT.decimals.old))
            const extrinsicHash = extrinsic.extrinsic.hash.toString();
            const transformedAmount = (amount as Balance).toBigInt();
            const timestamp = extrinsic.block.timestamp;
            await ensureAccounts([from.toString(), to.toString()]);

            const transferInfo = new Transfer(`${blockNo}-${extrinsic.idx}`);

            transferInfo.token = tokens.DOT.name;
            transferInfo.fromId = from.toString();
            transferInfo.toId = to.toString();
            transferInfo.timestamp = timestamp;
            transferInfo.extrinsicHash = extrinsicHash;
            transferInfo.amount = transformedAmount;
            transferInfo.fees = calculateFees(extrinsic)
            transferInfo.status = false;
            transferInfo.decimals = decimals;            

            await transferInfo.save();

        }
    }
}