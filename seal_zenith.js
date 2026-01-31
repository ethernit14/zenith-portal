const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults');
const { createMetadataAccountV3 } = require('@metaplex-foundation/mpl-token-metadata');
const { createSignerFromKeypair, signerIdentity } = require('@metaplex-foundation/umi');
const fs = require('fs');

async function seal() {
    // 1. Umi'yi Devnet'e bağla
    const umi = createUmi('https://api.devnet.solana.com');

    // 2. Senin "Patron" anahtarını (5Axsn...) yükle
    const keypairFile = JSON.parse(fs.readFileSync('/Users/ethernit/zent-keypair.json'));
    const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(keypairFile));
    const signer = createSignerFromKeypair(umi, keypair);
    umi.use(signerIdentity(signer));

    console.log("Mühürleme işlemi başlıyor... Patron:", signer.publicKey.toString());

    // 3. Zenith Token bilgilerini mühürle
    const mint = '4Wh9oPnM57tykNe7gauAkX8cX5B7CKRJ9epsD1USYko1';
    
    await createMetadataAccountV3(umi, {
        mint: mint,
        mintAuthority: signer,
        data: {
            name: "Zenith",
            symbol: "ZENT",
            uri: "https://gist.githubusercontent.com/ethernit14/90893f30e67cbffe2ebbcebf59752b37/raw/3b9b96209041aa23c4f9e39c9e652673b2b53763/metadata.json",
            sellerFeeBasisPoints: 0,
            creators: null,
            collection: null,
            uses: null,
        },
        isMutable: true,
        collectionDetails: null,
    }).sendAndConfirm(umi);

    console.log("✅ ZAFER! Zenith artık bir kimliğe sahip. Phantom'u kontrol et!");
}

seal();