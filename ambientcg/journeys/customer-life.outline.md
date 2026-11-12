# An artist imports a wood material

The publisher sets up three synthetic public catalog assets, Wood 096 and Bricks 012 materials and a Sky 004 HDRI, with valid texture archives and previews. This is World setup through the publishing door; ambientCG exposes no customer publishing API.

An artist making a wooden floor opens Volter Editor's material library, which calls fullJson with its normal Popular ordering and page size. The artist narrows the query to wood and the browser loads the thumbnail returned by the search through downloadFileByName.

Later, after the editor's result cache has expired, the artist selects the wood for import. The editor's fullJson lookup by the asset id as a keyword supplies the download link. The editor follows that returned link through getDownload and retrieves the returned media URL through downloadFileByName. The ZIP contains valid PNG color, roughness and normal maps for extraction. The artist then switches to the HDRI library to find a sky for lighting.

All customer reads are anonymous: this public catalog and its public bucket require no key or account. The publisher alone uses the World door. No customer write or state transition exists. Invalid inputs, unavailable filenames and alternative search options belong in the documented examples, rather than extra acts for this artist. The catalog remains populated for refresh.
