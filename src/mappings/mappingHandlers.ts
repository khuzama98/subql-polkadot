import { SubstrateEvent, SubstrateExtrinsic } from "@subql/types";
import { Transfer } from "../types";
import { Balance } from "@polkadot/types/interfaces";
import { Account } from '../types/models/Account';
import { tokens } from '../helpers/token'

const { SHIBUYA: {
    name, decimals
} } = tokens

async function ensureAccounts(accountIds: string[]): Promise<void> {
    for (const accountId of accountIds) {
        const account = await Account.get(accountId);
        if (!account) {
            await new Account(accountId).save();
        }
    }
}

function calculateFees(extrinsic: SubstrateExtrinsic): bigint {
    const eventRecord = extrinsic.events.find((event) => {
        return event.event.method == "Withdraw" && event.event.section == "balances"
    })

    if (eventRecord) {
        const {
            event: {
                data: [accountid, fee]
            }
        } = eventRecord

        const extrinsicSigner = extrinsic.extrinsic.signer.toString()
        const withdrawAccountId = accountid.toString()

        return extrinsicSigner === withdrawAccountId ? (fee as Balance).toBigInt() : BigInt(0)
    }

    return BigInt(0)
}


export async function handleTransfer(event: SubstrateEvent): Promise<void> {

    const {
        event: {
            data: [from, to, amount],
        },
    } = event;
    const blockNo = event.block.block.header.number.toNumber();
    const expendedDecimals = BigInt("1" + "0".repeat(decimals))
    const transformedAmount = (amount as Balance).toBigInt();
    const extrinsicHash = event.extrinsic?.extrinsic.hash.toString();
    const timestamp = event.block.timestamp;
    const transferInfo = new Transfer(`${blockNo}-${event.idx}`);
    const isSuccess = event.extrinsic ? event.extrinsic.success : false;

    await ensureAccounts([from.toString(), to.toString()]);

    transferInfo.token = name;
    transferInfo.fromId = from.toString();
    transferInfo.toId = to.toString();
    transferInfo.timestamp = timestamp;
    transferInfo.extrinsicHash = extrinsicHash;
    transferInfo.amount = transformedAmount;
    transferInfo.fees = event.extrinsic ? calculateFees(event.extrinsic) : BigInt(0)
    transferInfo.status = isSuccess;
    transferInfo.decimals = expendedDecimals;
    
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
            const expendedDecimals = BigInt("1" + "0".repeat(decimals))
            const blockNo = extrinsic.block.block.header.number.toNumber();
            const extrinsicHash = extrinsic.extrinsic.hash.toString();
            const transformedAmount = (amount as Balance).toBigInt();
            const timestamp = extrinsic.block.timestamp;
            await ensureAccounts([from.toString(), to.toString()]);

            const transferInfo = new Transfer(`${blockNo}-${extrinsic.idx}`);

            transferInfo.token = name;
            transferInfo.fromId = from.toString();
            transferInfo.toId = to.toString();
            transferInfo.timestamp = timestamp;
            transferInfo.extrinsicHash = extrinsicHash;
            transferInfo.amount = transformedAmount;
            transferInfo.fees = calculateFees(extrinsic)
            transferInfo.status = false;
            transferInfo.decimals = expendedDecimals;            

            await transferInfo.save();

        }
    }
}