#!/usr/bin/env bash
rm -fR ArchAIPack
mkdir -p ArchAIPack/simulation/ai
cp ../mod.json ArchAIPack

archDevDirectory="../simulation/ai/arch-dev"

declare -a bots=("Admiral" "Capitalist" "Communist" "Imperialist" "Mercantilist" "Patriot"  "Mason" "Unitary" "Theocrat")

for ai in ${bots[@]}
do
    targetDirectory="ArchAIPack/simulation/ai/arch-"$(echo ${ai}| tr '[:upper:][I]' '[:lower:][i]')
    mkdir -p ${targetDirectory}

    archSourceFiles=$(ls -1 ${archDevDirectory});

    for file in ${archSourceFiles}
    do
    # For debugging only
    #cat ${archDevDirectory}/${file}|awk -v target=${ai} 'BEGIN {c=1;}{if(!($2==target||$2=="DEBUG")){if($1=="///")c*=-1;else if(c==1)print $0;}}' > ${targetDirectory}/${file}

    # Release
    cat ${archDevDirectory}/${file}|awk -v target=${ai} 'BEGIN {c=1;}{if($2!=target){if($1=="///")c*=-1;else if(c==1)print $0;}}' > ${targetDirectory}/${file}
    done

    cp -f arch-${ai}.data.json ${targetDirectory}/data.json
done

cp -fR petraBased/* ArchAIPack/simulation/ai/

version=$(cat ../mod.json|grep "\"version\":"|awk {'print $2'}|tr -d "\",")

rm -f "../release/ArchAIPack.v"$version".zip"
#pyrogenesis -mod=ArchAIPack -archivebuild=ArchAIPack -archivebuild-output="../release/ArchAIPack.v"$version".zip" -archivebuild-compress
cd ArchAIPack
zip -r -9 ArchAIPack.zip *
cd -
rm -fR ArchAIPack/simulation ArchAIPack/mod.json
tar -czvf "../release/ArchAIPack.v"$version".tar.gz" ArchAIPack/

