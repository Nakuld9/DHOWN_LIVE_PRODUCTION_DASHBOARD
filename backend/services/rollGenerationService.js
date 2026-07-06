function generateRollId(machine,fabric,date,shift,no){
 return `${machine}-${fabric}-${date}-${shift}-${String(no).padStart(4,'0')}`;
}
module.exports={generateRollId};